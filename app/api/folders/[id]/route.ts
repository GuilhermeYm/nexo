import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { folders } from "@/lib/db/schema";
import { folderNameTaken, getOwnedFolder } from "@/lib/folders/queries";
import { folderNameSchema } from "@/lib/folders/types";
import { invalidateNoteListCache } from "@/lib/notes/cache";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * Renomear e apagar uma pasta.
 *
 * **Renomear adota.** A pasta que a IA criou e a pessoa renomeou passa a ser
 * dela (`source = 'user'`) — é um sinal claro de que ela quer a pasta.
 *
 * **Apagar não apaga nota.** As notas voltam para "sem pasta" (a FK de
 * `note_folders` cascateia a linha, não a nota). Mesmo princípio da lousa:
 * fechar não é apagar.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const renameSchema = z.object({ name: folderNameSchema });

async function authorize(key: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, error: errorResponse(401, "Não autenticado.") };

  const limit = await rateLimit({
    key: `${key}:${user.id}`,
    limit: 120,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.success) {
    return { user: null, error: errorResponse(429, "Muitas alterações. Aguarde um pouco.") };
  }
  return { user, error: null };
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/folders/[id]">) {
  let userId: string | null = null;
  try {
    const { user, error } = await authorize("folders:write");
    if (!user) return error;
    userId = user.id;

    const { id } = await ctx.params;
    if (!UUID.test(id)) return errorResponse(404, "Pasta não encontrada.");

    const parsed = renameSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(400, parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }
    const name = parsed.data.name;

    if (!(await getOwnedFolder(user.id, id))) {
      return errorResponse(404, "Pasta não encontrada.");
    }
    if ((await folderNameTaken(user.id, name, id)).taken) {
      return errorResponse(409, "Você já tem uma pasta com esse nome.");
    }

    const [folder] = await db
      .update(folders)
      .set({ name, source: "user", updatedAt: new Date() })
      .where(and(eq(folders.id, id), eq(folders.userId, user.id)))
      .returning({ id: folders.id, name: folders.name, source: folders.source });
    if (!folder) return errorResponse(404, "Pasta não encontrada.");

    await invalidateNoteListCache(user.id);
    return NextResponse.json({ folder });
  } catch (error) {
    const code = await logServerError("PATCH /api/folders/[id]", error, { userId }, request);
    // Corrida com outro nome igual: o índice único responde.
    if ((error as { code?: string })?.code === "23505") {
      return errorResponse(409, "Você já tem uma pasta com esse nome.");
    }
    return errorResponse(500, "Erro ao renomear a pasta.", code);
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/folders/[id]">) {
  let userId: string | null = null;
  try {
    const { user, error } = await authorize("folders:write");
    if (!user) return error;
    userId = user.id;

    const { id } = await ctx.params;
    if (!UUID.test(id)) return errorResponse(404, "Pasta não encontrada.");

    const [removed] = await db
      .delete(folders)
      .where(and(eq(folders.id, id), eq(folders.userId, user.id)))
      .returning({ id: folders.id });
    if (!removed) return errorResponse(404, "Pasta não encontrada.");

    await invalidateNoteListCache(user.id);
    return NextResponse.json({ deleted: removed.id });
  } catch (error) {
    const code = await logServerError("DELETE /api/folders/[id]", error, { userId }, request);
    return errorResponse(500, "Erro ao apagar a pasta.", code);
  }
}
