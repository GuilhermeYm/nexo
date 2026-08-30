import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { attachments, noteTags, notes, tags, workspaces } from "@/lib/db/schema";

export interface EditableNote {
  id: string;
  title: string;
  /** Texto puro — a projeção que alimenta busca e resumos. */
  content: string | null;
  /** Documento do editor. Nulo nas notas anteriores ao editor e nas da IA. */
  contentRich: unknown;
  type: string;
  /** Quem escreveu: `user` ou `ai`. Nunca é apagado. */
  source: string;
  workspaceId: string | null;
  workspaceName: string | null;
  updatedAt: Date;
  tags: { id: string; name: string; color: string | null }[];
  /**
   * O arquivo de onde a nota nasceu (um upload classificado pela IA), quando
   * há. É a referência de origem que o editor mostra — ver "Anexos como
   * janela": o vínculo mora em `attachments.note_id`, do lado do arquivo.
   */
  attachment: { id: string; filename: string; type: string } | null;
}

/**
 * A nota, se ela for desta pessoa.
 *
 * Mesma regra do workspace: `null` em vez de erro, para quem chama devolver
 * 404 e um id de outra pessoa ficar indistinguível de um id inexistente.
 * Notas com `status = 'deleted'` também respondem 404 — do ponto de vista de
 * quem navega, elas não existem mais.
 */
export async function getOwnedNote(
  userId: string,
  noteId: string
): Promise<EditableNote | null> {
  const [row] = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      contentRich: notes.contentRich,
      type: notes.type,
      source: notes.source,
      workspaceId: notes.workspaceId,
      workspaceName: workspaces.name,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .leftJoin(workspaces, eq(notes.workspaceId, workspaces.id))
    .where(
      and(
        eq(notes.id, noteId),
        eq(notes.userId, userId),
        ne(notes.status, "deleted")
      )
    )
    .limit(1);

  if (!row) return null;

  // Tags numa segunda consulta, não num join — uma nota com cinco tags
  // multiplicaria a linha por cinco. Mesmo padrão do `attachTags`.
  const noteTagRows = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(noteTags)
    .innerJoin(tags, eq(noteTags.tagId, tags.id))
    .where(eq(noteTags.noteId, noteId));

  // O arquivo de origem, quando a nota nasceu de um upload. O vínculo mora
  // do lado do anexo (`attachments.note_id`), e o `userId` entra no filtro
  // mesmo redundante: leitura que depende só da posse da nota fica frágil no
  // dia em que alguém mexer nela.
  const [attachment] = await db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      type: attachments.type,
    })
    .from(attachments)
    .where(and(eq(attachments.noteId, noteId), eq(attachments.userId, userId)))
    .limit(1);

  return { ...row, tags: noteTagRows, attachment: attachment ?? null };
}
