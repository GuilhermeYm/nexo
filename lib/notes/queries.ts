import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/lib/db";
import { attachments, noteTags, notes, tags, workspaces } from "@/lib/db/schema";
import {
  NOTE_LIST_PAGE_SIZE,
  type NoteListItem,
  type NoteListOptions,
  type NotePreview,
  type NoteListResult,
} from "@/lib/notes/list";

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
 * Inventário paginado das notas da pessoa.
 *
 * A Agenda também é persistida em `notes`, mas é uma estrutura interna com
 * tela própria. O `taskDate` nulo separa capturas e documentos reais dessas
 * listas diárias, evitando que um detalhe de implementação polua "Notas".
 */
export async function listOwnedNotes(
  userId: string,
  options: NoteListOptions = {}
): Promise<NoteListResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(48, Math.max(1, options.pageSize ?? NOTE_LIST_PAGE_SIZE));
  const query = options.query?.trim() ?? "";

  const conditions: SQL[] = [
    eq(notes.userId, userId),
    ne(notes.status, "deleted"),
    isNull(notes.taskDate),
  ];

  if (options.source && options.source !== "all") {
    conditions.push(eq(notes.source, options.source));
  }
  if (options.type && options.type !== "all") {
    conditions.push(eq(notes.type, options.type));
  }
  if (query) {
    const tsQuery = sql`websearch_to_tsquery('portuguese', ${query})`;
    conditions.push(
      or(
        sql`${notes.searchVector} @@ ${tsQuery}`,
        ilike(notes.title, `%${query}%`)
      )!
    );
  }

  const where = and(...conditions)!;
  const orderBy =
    options.sort === "created"
      ? [desc(notes.createdAt), desc(notes.id)]
      : options.sort === "title"
        ? [asc(notes.title), desc(notes.updatedAt)]
        : [desc(notes.updatedAt), desc(notes.id)];

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: notes.id,
        title: notes.title,
        content: notes.content,
        type: notes.type,
        source: notes.source,
        workspaceName: workspaces.name,
        updatedAt: notes.updatedAt,
        createdAt: notes.createdAt,
      })
      .from(notes)
      .leftJoin(workspaces, eq(notes.workspaceId, workspaces.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(notes).where(where),
  ]);

  const noteIds = rows.map((row) => row.id);
  const tagRows = noteIds.length
    ? await db
        .select({
          noteId: noteTags.noteId,
          id: tags.id,
          name: tags.name,
          color: tags.color,
        })
        .from(noteTags)
        .innerJoin(tags, eq(noteTags.tagId, tags.id))
        .where(
          and(
            inArray(noteTags.noteId, noteIds),
            // Defesa em profundidade: os ids já vieram de notas desta pessoa,
            // mas a tag também confirma a posse na própria consulta.
            eq(tags.userId, userId)
          )
        )
    : [];

  const tagsByNote = new Map<string, NoteListItem["tags"]>();
  for (const tag of tagRows) {
    const list = tagsByNote.get(tag.noteId) ?? [];
    list.push({ id: tag.id, name: tag.name, color: tag.color });
    tagsByNote.set(tag.noteId, list);
  }

  const total = totalRow?.value ?? 0;
  return {
    notes: rows.map(({ content, ...row }) => ({
      ...row,
      excerpt: noteExcerpt(content),
      tags: tagsByNote.get(row.id) ?? [],
    })),
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };
}

/**
 * Leitura rápida de uma nota dentro do acervo.
 *
 * O preview leva apenas texto puro, não o JSON do TipTap: além de manter o
 * painel leve, isso garante que conteúdo da pessoa nunca seja transformado em
 * HTML no navegador. A consulta repete a posse da nota, pois `DATABASE_URL`
 * pode passar por cima da RLS.
 */
export async function getOwnedNotePreview(
  userId: string,
  noteId: string
): Promise<NotePreview | null> {
  const [note] = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      type: notes.type,
      source: notes.source,
      workspaceName: workspaces.name,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .leftJoin(workspaces, eq(notes.workspaceId, workspaces.id))
    .where(
      and(
        eq(notes.id, noteId),
        eq(notes.userId, userId),
        ne(notes.status, "deleted"),
        isNull(notes.taskDate)
      )
    )
    .limit(1);

  return note ?? null;
}

function noteExcerpt(content: string | null): string | null {
  const normalized = content?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > 220 ? `${normalized.slice(0, 219)}…` : normalized;
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
