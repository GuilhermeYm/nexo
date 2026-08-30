import "server-only";

import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { aiJobs, noteTags, notes, tags, workspaces } from "@/lib/db/schema";

/**
 * Leituras do dashboard.
 *
 * Vivem fora das rotas porque tanto o Server Component da página quanto as
 * API routes precisam das mesmas consultas: a página pinta o primeiro estado
 * no servidor e o cliente revalida pelas rotas quando o Realtime avisa que
 * algo mudou. Uma consulta só, duas portas.
 *
 * Toda função recebe `userId` já derivado de `auth.getUser()`. Nenhuma delas
 * aceita id vindo do cliente.
 */

export const RECENT_LIMIT = 8;
export const JOBS_LIMIT = 8;

export interface WorkspaceSummary {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
  noteCount: number;
}

export async function listWorkspaces(
  userId: string
): Promise<WorkspaceSummary[]> {
  // Junção + agregação em vez de subconsulta correlata escrita à mão: aqui o
  // Drizzle monta as comparações com os tipos certos (`status` é enum), em
  // vez de eu confiar em interpolação de texto dentro de um `sql`.
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      icon: workspaces.icon,
      color: workspaces.color,
      isDefault: workspaces.isDefault,
      // `count(notes.id)` e não `count(*)`: com LEFT JOIN, um workspace vazio
      // ainda produz uma linha, e `count(*)` a contaria como 1.
      noteCount: sql<number>`count(${notes.id})::int`,
    })
    .from(workspaces)
    .leftJoin(
      notes,
      and(eq(notes.workspaceId, workspaces.id), eq(notes.status, "active"))
    )
    .where(eq(workspaces.userId, userId))
    .groupBy(workspaces.id)
    // O padrão primeiro, depois por nome: a ordem não pode dançar entre
    // recarregamentos, senão a barra de workspaces se reorganiza sozinha.
    .orderBy(desc(workspaces.isDefault), workspaces.name);

  return rows;
}

export interface RecentNote {
  id: string;
  title: string;
  excerpt: string | null;
  type: string;
  source: string;
  workspaceId: string | null;
  workspaceName: string | null;
  updatedAt: Date;
  createdAt: Date;
  tags: { id: string; name: string; color: string | null }[];
}

/**
 * As notas que o usuário tocou por último — editadas por ele ou criadas pela
 * IA para ele. Ordena por `updated_at` (não `created_at`) porque o painel se
 * chama "Recentes", e reeditar uma nota antiga é atividade recente.
 */
export async function listRecentNotes(
  userId: string,
  limit = RECENT_LIMIT
): Promise<RecentNote[]> {
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
    .from(notes)
    .leftJoin(workspaces, eq(notes.workspaceId, workspaces.id))
    .where(and(eq(notes.userId, userId), ne(notes.status, "deleted")))
    .orderBy(desc(notes.updatedAt))
    .limit(limit);

  return attachTags(rows);
}

export interface AiJobItem {
  id: string;
  kind: string;
  status: string;
  label: string;
  detail: string | null;
  noteId: string | null;
  creditsCost: number;
  createdAt: Date;
  finishedAt: Date | null;
}

const AI_JOB_COLUMNS = {
  id: aiJobs.id,
  kind: aiJobs.kind,
  status: aiJobs.status,
  label: aiJobs.label,
  detail: aiJobs.detail,
  noteId: aiJobs.noteId,
  creditsCost: aiJobs.creditsCost,
  createdAt: aiJobs.createdAt,
  finishedAt: aiJobs.finishedAt,
} as const;

/**
 * O feed de Tarefas: o que os agentes fizeram, estão fazendo, ou pararam de
 * fazer por falta de crédito.
 *
 * **As tarefas paradas por falta de crédito são fixas.** Elas pedem uma
 * decisão do usuário — assinar para retomar — e guardam `credits_cost` para a
 * cobrança dessa retomada. Não podem cair da lista porque tarefas mais novas
 * chegaram, nem serem despejadas por qualquer limpeza: é a razão de este feed
 * morar no Postgres e não só em cache (ver o comentário do enum em
 * `lib/db/schema.ts`). Por isso saem numa consulta própria, **sem `limit`**, e
 * vão sempre na frente. O histórico recebe o `limit` e nunca disputa espaço
 * com elas.
 *
 * Nenhuma rotina apaga linhas de `ai_jobs`. Uma limpeza por tempo foi
 * considerada e recusada: ela destruiria exatamente estas linhas.
 */
export async function listAiJobs(
  userId: string,
  limit = JOBS_LIMIT
): Promise<AiJobItem[]> {
  const pinnedQuery = db
    .select(AI_JOB_COLUMNS)
    .from(aiJobs)
    .where(
      and(
        eq(aiJobs.userId, userId),
        eq(aiJobs.status, "insufficient_credits")
      )
    )
    .orderBy(desc(aiJobs.createdAt));

  const historyQuery = db
    .select(AI_JOB_COLUMNS)
    .from(aiJobs)
    .where(
      and(
        eq(aiJobs.userId, userId),
        ne(aiJobs.status, "insufficient_credits")
      )
    )
    .orderBy(
      // Em execução e na fila no topo do histórico; o resto por data.
      sql`case
        when ${aiJobs.status} = 'running' then 0
        when ${aiJobs.status} = 'queued' then 1
        else 2
      end`,
      desc(aiJobs.createdAt)
    )
    .limit(limit);

  const [pinned, history] = await Promise.all([pinnedQuery, historyQuery]);
  return [...pinned, ...history];
}

/**
 * Busca full-text nas notas, usando a coluna gerada `search_vector`
 * (dicionário `portuguese`, ver drizzle/0003).
 *
 * `websearch_to_tsquery` aceita a sintaxe que as pessoas já conhecem de
 * buscador — aspas para frase exata, `or`, `-` para excluir — e, ao
 * contrário de `to_tsquery`, não estoura com entrada solta do usuário.
 */
export async function searchNotes(
  userId: string,
  query: string,
  limit = 12
): Promise<RecentNote[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const tsQuery = sql`websearch_to_tsquery('portuguese', ${trimmed})`;
  // Prefixo para a busca responder enquanto a pessoa ainda digita a palavra.
  const prefixPattern = `%${trimmed}%`;

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
      rank: sql<number>`ts_rank(${notes.searchVector}, ${tsQuery})`,
    })
    .from(notes)
    .leftJoin(workspaces, eq(notes.workspaceId, workspaces.id))
    .where(
      and(
        eq(notes.userId, userId),
        ne(notes.status, "deleted"),
        or(
          sql`${notes.searchVector} @@ ${tsQuery}`,
          sql`${notes.title} ilike ${prefixPattern}`
        )
      )
    )
    .orderBy(
      sql`ts_rank(${notes.searchVector}, ${tsQuery}) desc`,
      desc(notes.updatedAt)
    )
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
 * Carrega as tags das notas em uma consulta só, em vez de uma por nota.
 * Com 8 itens no painel a diferença é pequena; com a busca aberta, não é.
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
    // `inArray` em vez de um `= any()` montado à mão: o Drizzle sabe o tipo
    // da coluna e serializa a lista como uuid[], em vez de deixar o driver
    // adivinhar a partir de um array de strings.
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
