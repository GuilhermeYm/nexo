import "server-only";

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import type { RecentNote } from "@/lib/dashboard/queries";
import { db } from "@/lib/db";
import { noteTags, notes, tags, workspaces } from "@/lib/db/schema";

/**
 * Leituras da página de Tags (`/dashboard/tags`).
 *
 * Mesmo contrato de `lib/dashboard/queries.ts`: toda função recebe `userId`
 * já derivado de `auth.getUser()` — nenhum id chega do cliente.
 */

export interface TagWithUsage {
  id: string;
  name: string;
  color: string | null;
  /** Notas vivas marcadas com esta tag. */
  noteCount: number;
  /**
   * A última vez que uma nota com esta tag foi tocada. Nula quando a tag
   * ainda não marcou nada — recém-criada e nunca usada, por exemplo.
   */
  lastUsedAt: Date | null;
  createdAt: Date;
}

/**
 * Todas as tags do usuário com contagem e frescor de uso.
 *
 * A ordenação é pelo uso, não pela criação da tag: reeditar uma nota antiga
 * traz a tag dela de volta para o topo, que é o que "recentes" significa para
 * quem está procurando. Tags sem nenhuma nota vão para o fim, da mais nova
 * para a mais velha.
 */
export async function listTagsWithUsage(
  userId: string
): Promise<TagWithUsage[]> {
  return db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      createdAt: tags.createdAt,
      // `count(notes.id)` e não `count(*)`: com LEFT JOIN, uma tag sem nota
      // ainda produz uma linha, e `count(*)` a contaria como 1.
      noteCount: sql<number>`count(${notes.id})::int`,
      lastUsedAt: sql<Date | null>`max(${notes.updatedAt})`,
    })
    .from(tags)
    .leftJoin(noteTags, eq(noteTags.tagId, tags.id))
    // Notas excluídas não contam: uma tag cujo último uso foi numa nota
    // apagada não pode continuar parecendo fresca.
    .leftJoin(
      notes,
      and(eq(notes.id, noteTags.noteId), ne(notes.status, "deleted"))
    )
    .where(eq(tags.userId, userId))
    .groupBy(tags.id)
    .orderBy(
      sql`max(${notes.updatedAt}) desc nulls last`,
      desc(tags.createdAt)
    );
}

/**
 * As notas marcadas com uma tag, da tocada por último para a mais antiga.
 *
 * Devolve `null` quando a tag não é do usuário — a rota traduz para 404, e
 * não 403, porque confirmar que a tag existe já seria vazar informação.
 */
export async function listNotesByTag(
  userId: string,
  tagId: string,
  limit = 50
): Promise<RecentNote[] | null> {
  // Posse primeiro: sem ela, a listagem abaixo falaria sobre tags de outra
  // pessoa pela diferença entre "vazia" e "inexistente".
  const [owned] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
    .limit(1);
  if (!owned) return null;

  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      type: notes.type,
      source: notes.source,
      workspaceId: notes.workspaceId,
      workspaceName: workspaces.name,
      updatedAt: notes.updatedAt,
      createdAt: notes.createdAt,
    })
    .from(noteTags)
    .innerJoin(notes, eq(noteTags.noteId, notes.id))
    .leftJoin(workspaces, eq(notes.workspaceId, workspaces.id))
    .where(
      and(
        eq(noteTags.tagId, tagId),
        eq(notes.userId, userId),
        ne(notes.status, "deleted")
      )
    )
    .orderBy(desc(notes.updatedAt))
    .limit(limit);

  return attachTags(rows);
}

/* ---------------------------------------------------------------------- */

type NoteRow = {
  id: string;
  title: string;
  content: string | null;
  type: string;
  source: string;
  workspaceId: string | null;
  workspaceName: string | null;
  updatedAt: Date;
  createdAt: Date;
};

/**
 * Espelha o `attachTags` de `lib/dashboard/queries.ts`: carrega as tags das
 * notas em uma consulta só e monta o resumo. Duplicado de propósito — aquela
 * consulta é da superfície do dashboard e esta página não pode depender de
 * uma peça que outra frente de trabalho edita.
 */
async function attachTags(rows: NoteRow[]): Promise<RecentNote[]> {
  if (rows.length === 0) return [];

  const noteIds = rows.map((row) => row.id);
  const tagRows = await db
    .select({
      noteId: noteTags.noteId,
      id: tags.id,
      name: tags.name,
      color: tags.color,
    })
    .from(noteTags)
    .innerJoin(tags, eq(noteTags.tagId, tags.id))
    .where(inArray(noteTags.noteId, noteIds));

  const byNote = new Map<string, RecentNote["tags"]>();
  for (const tag of tagRows) {
    const list = byNote.get(tag.noteId) ?? [];
    list.push({ id: tag.id, name: tag.name, color: tag.color });
    byNote.set(tag.noteId, list);
  }

  return rows.map(({ content, ...row }) => ({
    ...row,
    excerpt: buildExcerpt(content),
    tags: byNote.get(row.id) ?? [],
  }));
}

/** Primeira linha útil do conteúdo, cortada em limite de palavra. */
function buildExcerpt(content: string | null): string | null {
  if (!content) return null;

  const flat = content.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= 140) return flat;

  const cut = flat.slice(0, 140);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 90 ? lastSpace : 140)}…`;
}

/* ---------------------------------------------------------------------- */

/**
 * O que a API `/api/tags/graph` devolve para o modo grafo.
 *
 * `links` usa `source`/`target` porque é o formato que `react-force-graph-2d`
 * espera; o componente mapeia `source` para o id da nota e `target` para o id
 * da tag.
 */
export interface TagGraph {
  notes: Array<{
    id: string;
    title: string;
    type: string;
    workspaceId: string | null;
  }>;
  tags: Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
  links: Array<{ source: string; target: string }>;
}

/**
 * As notas, as tags e as relações para desenhar o grafo.
 *
 * Três consultas independentes, sem join — uma nota com cinco tags não
 * multiplica a linha por cinco, e uma tag sem nota não desaparece. O limite
 * de notas é o teto de nós que o canvas consegue segurar sem engasgar; o
 * cliente avisa quando o grafo foi truncado.
 */
export async function listTagGraph(
  userId: string,
  noteLimit = 200
): Promise<TagGraph> {
  const [noteRows, tagRows] = await Promise.all([
    db
      .select({
        id: notes.id,
        title: notes.title,
        type: notes.type,
        workspaceId: notes.workspaceId,
      })
      .from(notes)
      .where(and(eq(notes.userId, userId), ne(notes.status, "deleted")))
      .orderBy(desc(notes.updatedAt))
      .limit(noteLimit),
    db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(tags)
      .where(eq(tags.userId, userId)),
  ]);

  const noteIds = noteRows.map((row) => row.id);
  const linkRows =
    noteIds.length === 0
      ? []
      : await db
          .select({ noteId: noteTags.noteId, tagId: noteTags.tagId })
          .from(noteTags)
          .where(inArray(noteTags.noteId, noteIds));

  return {
    notes: noteRows,
    tags: tagRows,
    links: linkRows.map((row) => ({ source: row.noteId, target: row.tagId })),
  };
}
