import { and, eq, isNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { getOwnedFolder, placeNoteByUser } from "@/lib/folders/queries";
import { invalidateNoteListCache } from "@/lib/notes/cache";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * A pessoa põe a nota numa pasta, ou a tira de todas (`folderId: null`).
 *
 * As duas contam como escolha dela (`source = 'user'`): a organização da IA
 * não mexe mais nesta nota — nem para pôr de volta numa pasta de onde a
 * pessoa a tirou. Não toca em `notes`, então a nota não sobe em Recentes.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bodySchema = z.object({ folderId: z.string().regex(UUID).nullable() });

export async function PUT(request: Request, ctx: RouteContext<"/api/notes/[id]/folder">) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `notes:folder:${user.id}`,
      limit: 300,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) return errorResponse(429, "Muitas alterações. Aguarde um pouco.");

    const { id } = await ctx.params;
    if (!UUID.test(id)) return errorResponse(404, "Nota não encontrada.");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse(400, "Pasta inválida.");
    const { folderId } = parsed.data;

    const [note] = await db
      .select({ id: notes.id })
      .from(notes)
      .where(
        and(
          eq(notes.id, id),
          eq(notes.userId, user.id),
          ne(notes.status, "deleted"),
          isNull(notes.taskDate)
        )
      )
      .limit(1);
    if (!note) return errorResponse(404, "Nota não encontrada.");

    const folder = folderId ? await getOwnedFolder(user.id, folderId) : null;
    if (folderId && !folder) return errorResponse(404, "Pasta não encontrada.");

    await placeNoteByUser(user.id, note.id, folder?.id ?? null);
    await invalidateNoteListCache(user.id);

    return NextResponse.json({ folder: folder ? { id: folder.id, name: folder.name } : null });
  } catch (error) {
    const code = await logServerError("PUT /api/notes/[id]/folder", error, { userId }, request);
    return errorResponse(500, "Erro ao mover a nota.", code);
  }
}
