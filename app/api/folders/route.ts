import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { folders } from "@/lib/db/schema";
import { folderNameTaken, listFolders } from "@/lib/folders/queries";
import { folderNameSchema, MAX_FOLDERS_PER_USER } from "@/lib/folders/types";
import { invalidateNoteListCache } from "@/lib/notes/cache";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * As pastas de notas da pessoa (0026).
 *
 * Toda escrita passa por aqui, e não pelo PostgREST: `folders` não tem GRANT
 * de escrita para `authenticated`. O `user_id` vem do token, nunca do corpo.
 */

const createSchema = z.object({ name: folderNameSchema });

export async function GET(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `folders:read:${user.id}`,
      limit: 600,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) return errorResponse(429, "Muitas requisições. Aguarde um pouco.");

    return NextResponse.json(
      { folders: await listFolders(user.id) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    const code = await logServerError("GET /api/folders", error, { userId }, request);
    return errorResponse(500, "Erro ao carregar as pastas.", code);
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `folders:write:${user.id}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) return errorResponse(429, "Muitas alterações. Aguarde um pouco.");

    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(400, parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }
    const name = parsed.data.name;

    const existing = await folderNameTaken(user.id, name);
    if (existing.taken) {
      return errorResponse(409, "Você já tem uma pasta com esse nome.");
    }
    if (existing.total >= MAX_FOLDERS_PER_USER) {
      return errorResponse(409, `Uma conta comporta até ${MAX_FOLDERS_PER_USER} pastas.`);
    }

    const [folder] = await db
      .insert(folders)
      .values({ userId: user.id, name, source: "user" })
      .onConflictDoNothing()
      .returning({ id: folders.id, name: folders.name, source: folders.source });
    if (!folder) return errorResponse(409, "Você já tem uma pasta com esse nome.");

    await invalidateNoteListCache(user.id);
    return NextResponse.json({ folder: { ...folder, noteCount: 0 } }, { status: 201 });
  } catch (error) {
    const code = await logServerError("POST /api/folders", error, { userId }, request);
    return errorResponse(500, "Erro ao criar a pasta.", code);
  }
}
