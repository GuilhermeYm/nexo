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
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  attachments,
  folders,
  noteAiState,
  noteFolders,
  noteTags,
  notes,
  tags,
  workspaces,
} from "@/lib/db/schema";
import {
  NOTE_LIST_PAGE_SIZE,
  type NoteListItem,
  type NoteListOptions,
  type NotePreview,
  type NoteListResult,
} from "@/lib/notes/list";
import type { NoteDeletionImpact } from "@/lib/notes/deletion-impact";
import { likeContains } from "@/lib/utils";

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
 * As notas vivas de uma pasta.
 *
 * O critério é o mesmo da contagem em `listFolders` — nota ativa e fora da
 * Agenda — porque é esse número que a pessoa vê antes de decidir. Qualquer
 * divergência aqui faria o aviso prometer uma coisa e a exclusão fazer outra.
 */
export async function listFolderNoteIds(
  userId: string,
  folderId: string
): Promise<string[]> {
  const rows = await db
    .select({ id: notes.id })
    .from(noteFolders)
    .innerJoin(
      notes,
      and(
        eq(notes.id, noteFolders.noteId),
        eq(notes.userId, userId),
        ne(notes.status, "deleted"),
        isNull(notes.taskDate)
      )
    )
    .where(and(eq(noteFolders.folderId, folderId), eq(noteFolders.userId, userId)));
  return rows.map((row) => row.id);
}

/**
 * Tags das notas que podem ser apagadas pelo acervo e o impacto que remover
 * cada tag teria fora da seleção. A posse é aplicada às notas e às tags: IDs
 * forjados simplesmente não entram no resultado.
 */
export async function getNoteDeletionImpact(
  userId: string,
  selectedNoteIds: string[]
): Promise<NoteDeletionImpact> {
  const [relatedTags, attachmentRows] = await Promise.all([
    db
      .selectDistinct({
        id: tags.id,
        name: tags.name,
        color: tags.color,
      })
      .from(noteTags)
      .innerJoin(
        notes,
        and(
          eq(notes.id, noteTags.noteId),
          eq(notes.userId, userId),
          ne(notes.status, "deleted"),
          isNull(notes.taskDate)
        )
      )
      .innerJoin(
        tags,
        and(eq(tags.id, noteTags.tagId), eq(tags.userId, userId))
      )
      .where(inArray(noteTags.noteId, selectedNoteIds))
      .orderBy(asc(tags.name)),
    db
      .select({ count: count(attachments.id) })
      .from(attachments)
      .innerJoin(
        notes,
        and(
          eq(notes.id, attachments.noteId),
          eq(notes.userId, userId),
          ne(notes.status, "deleted"),
          isNull(notes.taskDate)
        )
      )
      .where(
        and(
          eq(attachments.userId, userId),
          inArray(attachments.noteId, selectedNoteIds)
        )
      ),
  ]);
  const attachmentCount = attachmentRows[0]?.count ?? 0;

  if (relatedTags.length === 0) return { attachmentCount, tags: [] };

  const tagIds = relatedTags.map((tag) => tag.id);
  const otherConditions = and(
    inArray(noteTags.tagId, tagIds),
    eq(notes.userId, userId),
    ne(notes.status, "deleted"),
    // Inclui inclusive uma lista da Agenda: a tag é global e desapareceria
    // dela também, então esconder esse uso tornaria a confirmação enganosa.
    notInArray(notes.id, selectedNoteIds)
  );

  const [counts, previews] = await Promise.all([
    db
      .select({
        tagId: noteTags.tagId,
        count: count(notes.id),
      })
      .from(noteTags)
      .innerJoin(notes, eq(notes.id, noteTags.noteId))
      .where(otherConditions)
      .groupBy(noteTags.tagId),
    db
      .select({
        tagId: noteTags.tagId,
        id: notes.id,
        title: notes.title,
      })
      .from(noteTags)
      .innerJoin(notes, eq(notes.id, noteTags.noteId))
      .where(otherConditions)
      .orderBy(desc(notes.updatedAt)),
  ]);

  const countByTag = new Map(counts.map((row) => [row.tagId, row.count]));
  const previewsByTag = new Map<string, Array<{ id: string; title: string }>>();
  for (const note of previews) {
    const current = previewsByTag.get(note.tagId) ?? [];
    if (current.length < 3) current.push({ id: note.id, title: note.title });
    previewsByTag.set(note.tagId, current);
  }

  return {
    attachmentCount,
    tags: relatedTags.map((tag) => ({
      ...tag,
      otherNoteCount: countByTag.get(tag.id) ?? 0,
      otherNotes: previewsByTag.get(tag.id) ?? [],
    })),
  };
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
  // A pasta mora em `note_folders` (0026). "Sem pasta" cobre as duas formas:
  // nota sem linha e nota que a pessoa tirou de todas (`folder_id` nulo).
  if (options.folder === "none") {
    conditions.push(isNull(noteFolders.folderId));
  } else if (options.folder && options.folder !== "all") {
    conditions.push(eq(noteFolders.folderId, options.folder));
  }
  if (query) {
    const tsQuery = sql`websearch_to_tsquery('portuguese', ${query})`;
    conditions.push(
      or(
        sql`${notes.searchVector} @@ ${tsQuery}`,
        ilike(notes.title, likeContains(query))
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
        ...SUMMARY_COLUMNS,
        type: notes.type,
        source: notes.source,
        workspaceName: workspaces.name,
        folderId: folders.id,
        folderName: folders.name,
        folderSource: noteFolders.source,
        updatedAt: notes.updatedAt,
        createdAt: notes.createdAt,
      })
      .from(notes)
      .leftJoin(workspaces, eq(notes.workspaceId, workspaces.id))
      .leftJoin(noteFolders, folderJoin(userId))
      .leftJoin(folders, and(eq(folders.id, noteFolders.folderId), eq(folders.userId, userId)))
      .leftJoin(noteAiState, aiStateJoin(userId))
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ value: count() })
      .from(notes)
      .leftJoin(noteFolders, folderJoin(userId))
      .where(where),
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
    notes: rows.map(
      ({ content, folderId, folderName, folderSource, summary, summaryHash, dirtyHash, ...row }) => ({
      ...row,
      summary: isSummaryStale({ summary, summaryHash, dirtyHash }) ? null : summary,
      folder:
        folderId && folderName
          ? { id: folderId, name: folderName, source: folderSource ?? "user" }
          : null,
      excerpt: noteExcerpt(content),
      tags: tagsByNote.get(row.id) ?? [],
    })
    ),
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
      ...SUMMARY_COLUMNS,
      type: notes.type,
      source: notes.source,
      workspaceName: workspaces.name,
      folderId: folders.id,
      folderName: folders.name,
      folderSource: noteFolders.source,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .leftJoin(workspaces, eq(notes.workspaceId, workspaces.id))
    .leftJoin(noteFolders, folderJoin(userId))
    .leftJoin(folders, and(eq(folders.id, noteFolders.folderId), eq(folders.userId, userId)))
    .leftJoin(noteAiState, aiStateJoin(userId))
    .where(
      and(
        eq(notes.id, noteId),
        eq(notes.userId, userId),
        ne(notes.status, "deleted"),
        isNull(notes.taskDate)
      )
    )
    .limit(1);

  if (!note) return null;
  const { folderId, folderName, folderSource, summaryHash, dirtyHash, ...rest } = note;
  return {
    ...rest,
    summaryStale: isSummaryStale({ summary: rest.summary, summaryHash, dirtyHash }),
    folder:
      folderId && folderName
        ? { id: folderId, name: folderName, source: folderSource ?? "user" }
        : null,
  };
}

/**
 * O resumo da Nexo e o que decide se ele ainda vale. Os hashes ficam no
 * servidor (GRANT por coluna em 0024): o cliente recebe só o veredito.
 */
export const SUMMARY_COLUMNS = {
  summary: noteAiState.summary,
  summaryHash: noteAiState.summaryHash,
  dirtyHash: noteAiState.dirtyHash,
} as const;

/** A linha de `note_ai_state` da nota, cruzando o dono também ali. */
export function aiStateJoin(userId: string) {
  return and(eq(noteAiState.noteId, notes.id), eq(noteAiState.userId, userId));
}

/** Mesma regra de `getNoteAiView`: o texto salvo mudou depois do resumo. */
export function isSummaryStale(row: {
  summary: string | null;
  summaryHash: string | null;
  dirtyHash: string | null;
}): boolean {
  return row.summary !== null && row.dirtyHash !== null && row.summaryHash !== row.dirtyHash;
}

/** A linha de `note_folders` da nota, cruzando o dono também ali. */
function folderJoin(userId: string) {
  return and(eq(noteFolders.noteId, notes.id), eq(noteFolders.userId, userId));
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
