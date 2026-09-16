import { and, eq, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { noteTags, notes, tags } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { invalidateNoteListCache } from "@/lib/notes/cache";
import { createClient } from "@/lib/supabase/server";
import { paletteFromName } from "@/lib/tags/palette";

/**
 * Marcar e desmarcar uma nota com uma tag.
 *
 * É o que deixa a pessoa etiquetar direto da janela da lousa, sem passar pelo
 * editor. Até aqui só a classificação por IA criava tags; esta rota abre o
 * mesmo caminho para a mão.
 *
 * **A cor.** Uma tag nova nasce com a matiz derivada do nome
 * (`paletteFromName`) já gravada — assim ela aparece colorida em todo lugar,
 * não só na página que deriva a cor na hora de exibir.
 *
 * **Sem auditoria.** Mesmo critério do corpo da nota: marcar e desmarcar é
 * frequente e reversível pelo mesmo gesto. O que a trilha registra é a troca
 * de título e a exclusão.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Teto por nota: etiquetar não é indexar, e uma nota com trinta tags não
 *  ajuda a reencontrar nada. */
const MAX_TAGS_PER_NOTE = 20;

const addTagSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Escreva o nome da tag.")
    .max(40, "No máximo 40 caracteres.")
    // Minúsculas e espaços colapsados: a mesma normalização da classificação
    // por IA, para "Projeto X" e "projeto  x" não virarem duas tags.
    .transform((value) => value.toLowerCase().replace(/\s+/g, " ")),
});

/** Confere que a nota é desta pessoa e não está na lixeira. */
async function ownedNote(noteId: string, userId: string) {
  const [row] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(
      and(eq(notes.id, noteId), eq(notes.userId, userId), ne(notes.status, "deleted"))
    )
    .limit(1);
  return row ?? null;
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/notes/[id]/tags">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const limit = await rateLimit({
      key: `notes:tags:${user.id}`,
      limit: 240,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas alterações de tag. Aguarde um pouco.");
    }

    const { id } = await ctx.params;
    if (!UUID.test(id)) return errorResponse(404, "Nota não encontrada.");

    const parsed = addTagSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Dados inválidos."
      );
    }
    const name = parsed.data.name;

    if (!(await ownedNote(id, user.id))) {
      return errorResponse(404, "Nota não encontrada.");
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(noteTags)
      .where(eq(noteTags.noteId, id));
    if (count >= MAX_TAGS_PER_NOTE) {
      return errorResponse(
        409,
        `Uma nota comporta até ${MAX_TAGS_PER_NOTE} tags.`
      );
    }

    // Upsert da tag do usuário: o índice único é `(user_id, name)`.
    const [tag] = await db
      .insert(tags)
      .values({ userId: user.id, name, color: paletteFromName(name) })
      .onConflictDoUpdate({
        target: [tags.userId, tags.name],
        set: { name },
      })
      .returning({ id: tags.id, name: tags.name, color: tags.color });

    // O vínculo. `onConflictDoNothing` torna o POST idempotente: marcar de
    // novo não é erro.
    await db
      .insert(noteTags)
      .values({ noteId: id, tagId: tag.id })
      .onConflictDoNothing();

    await invalidateNoteListCache(user.id);

    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    const code = await logServerError("POST /api/notes/[id]/tags", error);
    return errorResponse(500, "Erro ao marcar a tag.", code);
  }
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/notes/[id]/tags">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const { id } = await ctx.params;
    if (!UUID.test(id)) return errorResponse(404, "Nota não encontrada.");

    const tagId = new URL(request.url).searchParams.get("tagId") ?? "";
    if (!UUID.test(tagId)) return errorResponse(400, "Tag inválida.");

    if (!(await ownedNote(id, user.id))) {
      return errorResponse(404, "Nota não encontrada.");
    }

    // Só o vínculo sai. A tag continua existindo — ela pode marcar outras
    // notas, e varrer tag órfã é outra conversa.
    await db
      .delete(noteTags)
      .where(and(eq(noteTags.noteId, id), eq(noteTags.tagId, tagId)));

    await invalidateNoteListCache(user.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = await logServerError("DELETE /api/notes/[id]/tags", error);
    return errorResponse(500, "Erro ao remover a tag.", code);
  }
}
