import "server-only";

import { and, desc, eq, inArray, not, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { aiJobs, noteAiState, notes, tags } from "@/lib/db/schema";
import type { AiJobItem } from "@/lib/dashboard/queries";

/**
 * O histórico inteiro de Tarefas e o detalhe de cada uma — o que a tela
 * cheia do painel lê. O painel pequeno continua em `listAiJobs`, com as 8
 * mais recentes; aqui não há corte, só páginas.
 *
 * As fixadas (`isPinnedJob`) ficam fora do histórico: a tela cheia as recebe
 * do próprio painel, que já as mantém vivas.
 */

export const HISTORY_PAGE_SIZE = 30;

export const JOB_STATUS_FILTERS = ["all", "succeeded", "failed", "active"] as const;
export const JOB_KIND_FILTERS = ["all", "summarize", "classify", "transcribe"] as const;

export type JobStatusFilter = (typeof JOB_STATUS_FILTERS)[number];
export type JobKindFilter = (typeof JOB_KIND_FILTERS)[number];

export const historyQuerySchema = z.object({
  status: z.enum(JOB_STATUS_FILTERS).default("all"),
  kind: z.enum(JOB_KIND_FILTERS).default("all"),
  // `<ISO>|<uuid>` da última linha da página anterior.
  cursor: z
    .string()
    .max(80)
    .regex(/^[0-9T:.\-+Z]+\|[0-9a-f-]{36}$/i)
    .optional(),
});

export interface JobHistoryPage {
  jobs: AiJobItem[];
  nextCursor: string | null;
}

/** O espelho em SQL de `isPinnedJob`. Mudou lá, muda aqui (e em `listAiJobs`). */
const pinnedCondition = or(
  eq(aiJobs.status, "insufficient_credits"),
  and(eq(aiJobs.kind, "summarize"), eq(aiJobs.status, "queued"))
);

/**
 * Uma página do histórico, do mais novo para o mais antigo.
 *
 * Paginação por chave (`created_at`, `id`) e não por `offset`: uma tarefa
 * nova chegando enquanto a pessoa rola não duplica nem pula linha na página
 * seguinte. O índice `ai_jobs_user_created_at_idx` serve a consulta.
 */
export async function listJobHistory(
  userId: string,
  filters: z.infer<typeof historyQuerySchema>
): Promise<JobHistoryPage> {
  const conditions = [eq(aiJobs.userId, userId), not(pinnedCondition!)];

  if (filters.status === "succeeded") conditions.push(eq(aiJobs.status, "succeeded"));
  if (filters.status === "failed") conditions.push(eq(aiJobs.status, "failed"));
  if (filters.status === "active") {
    conditions.push(inArray(aiJobs.status, ["queued", "running", "waiting_configuration"]));
  }
  if (filters.kind !== "all") conditions.push(eq(aiJobs.kind, filters.kind));

  if (filters.cursor) {
    const [stamp, id] = filters.cursor.split("|");
    const at = new Date(stamp);
    if (!Number.isNaN(at.getTime())) {
      // Parâmetros, não colunas de outra tabela: a comparação de linha é
      // sobre `ai_jobs` só, sem subconsulta.
      conditions.push(
        sql`(${aiJobs.createdAt}, ${aiJobs.id}) < (${at.toISOString()}::timestamptz, ${id}::uuid)`
      );
    }
  }

  const rows = await db
    .select({
      id: aiJobs.id,
      kind: aiJobs.kind,
      status: aiJobs.status,
      label: aiJobs.label,
      detail: aiJobs.detail,
      noteId: aiJobs.noteId,
      creditsCost: aiJobs.creditsCost,
      createdAt: aiJobs.createdAt,
      finishedAt: aiJobs.finishedAt,
    })
    .from(aiJobs)
    .where(and(...conditions))
    .orderBy(desc(aiJobs.createdAt), desc(aiJobs.id))
    .limit(HISTORY_PAGE_SIZE + 1);

  const hasMore = rows.length > HISTORY_PAGE_SIZE;
  const jobs = hasMore ? rows.slice(0, HISTORY_PAGE_SIZE) : rows;
  const last = jobs[jobs.length - 1];

  return {
    jobs,
    nextCursor:
      hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
  };
}

/* ---------------------------------------------------------------------- */
/* Detalhe                                                                 */
/* ---------------------------------------------------------------------- */

/**
 * O `result` tem três formatos — leitura de nota, upload e transcrição — e
 * as linhas antigas nenhum. Tudo opcional, tudo tolerante: um campo que não
 * casa é ignorado, nunca derruba o detalhe.
 */
const resultSchema = z
  .object({
    tagsAdded: z.array(z.string()).optional(),
    tagsReused: z.array(z.string()).optional(),
    tagsCreated: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    typeSuggested: z.string().optional(),
    summarized: z.boolean().optional(),
    summaryChars: z.number().optional(),
    noteChars: z.number().optional(),
    inputChars: z.number().optional(),
    transcriptChars: z.number().optional(),
    truncated: z.boolean().optional(),
    attempt: z.number().optional(),
    durationMs: z.number().optional(),
    provider: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    classifyProvider: z.string().nullable().optional(),
    classifyModel: z.string().nullable().optional(),
  })
  .partial();

export interface JobDetailTag {
  name: string;
  color: string | null;
  /** Criada nesta tarefa (e não reusada do vocabulário da pessoa). */
  created: boolean;
}

export interface JobDetail {
  id: string;
  kind: string;
  status: string;
  label: string;
  detail: string | null;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  note: { id: string; title: string; available: boolean } | null;
  /** Só na leitura de nota: o resumo vive em `note_ai_state`, nunca no job. */
  summary: { text: string; stale: boolean } | null;
  summarized: boolean | null;
  summaryChars: number | null;
  tags: JobDetailTag[];
  typeSuggested: string | null;
  inputChars: number | null;
  noteChars: number | null;
  transcriptChars: number | null;
  truncated: boolean;
  attempt: number | null;
  provider: string | null;
  model: string | null;
  /** Na transcrição, a classificação do texto é outra chamada, outro modelo. */
  classifyProvider: string | null;
  classifyModel: string | null;
}

export async function getJobDetail(
  userId: string,
  jobId: string
): Promise<JobDetail | null> {
  const [job] = await db
    .select({
      id: aiJobs.id,
      kind: aiJobs.kind,
      status: aiJobs.status,
      label: aiJobs.label,
      detail: aiJobs.detail,
      errorCode: aiJobs.errorCode,
      result: aiJobs.result,
      noteId: aiJobs.noteId,
      createdAt: aiJobs.createdAt,
      startedAt: aiJobs.startedAt,
      finishedAt: aiJobs.finishedAt,
    })
    .from(aiJobs)
    .where(and(eq(aiJobs.id, jobId), eq(aiJobs.userId, userId)))
    .limit(1);

  if (!job) return null;

  const parsed = resultSchema.safeParse(job.result ?? {});
  const result = parsed.success ? parsed.data : {};

  const [note, state] = job.noteId
    ? await Promise.all([
        db
          .select({ id: notes.id, title: notes.title, status: notes.status })
          .from(notes)
          .where(and(eq(notes.id, job.noteId), eq(notes.userId, userId)))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        job.kind === "summarize"
          ? db
              .select({
                summary: noteAiState.summary,
                summaryHash: noteAiState.summaryHash,
                dirtyHash: noteAiState.dirtyHash,
              })
              .from(noteAiState)
              .where(
                and(eq(noteAiState.noteId, job.noteId), eq(noteAiState.userId, userId))
              )
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
      ])
    : [null, null];

  // Leitura de nota separa criadas de reusadas; upload e transcrição só
  // listam as tags — lá, "criada" não foi registrado e fica falso.
  const created = new Set(result.tagsCreated ?? []);
  const tagNames = [
    ...new Set([...(result.tagsAdded ?? []), ...(result.tags ?? [])]),
  ];
  const colors = tagNames.length
    ? await db
        .select({ name: tags.name, color: tags.color })
        .from(tags)
        .where(and(eq(tags.userId, userId), inArray(tags.name, tagNames)))
    : [];
  const colorOf = new Map(colors.map((tag) => [tag.name, tag.color]));

  const durationMs =
    result.durationMs ??
    (job.startedAt && job.finishedAt
      ? job.finishedAt.getTime() - job.startedAt.getTime()
      : null);

  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    label: job.label,
    detail: job.detail,
    errorCode: job.errorCode,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    durationMs,
    note: note
      ? { id: note.id, title: note.title, available: note.status !== "deleted" }
      : null,
    summary:
      state?.summary && note?.status !== "deleted"
        ? {
            text: state.summary,
            stale: state.dirtyHash !== null && state.summaryHash !== state.dirtyHash,
          }
        : null,
    summarized: result.summarized ?? null,
    summaryChars: result.summaryChars ?? null,
    tags: tagNames.map((name) => ({
      name,
      color: colorOf.get(name) ?? null,
      created: created.has(name),
    })),
    typeSuggested: result.typeSuggested ?? null,
    inputChars: result.inputChars ?? null,
    noteChars: result.noteChars ?? null,
    transcriptChars: result.transcriptChars ?? null,
    truncated: result.truncated ?? false,
    attempt: result.attempt ?? null,
    provider: result.provider ?? null,
    model: result.model ?? null,
    classifyProvider: result.classifyProvider ?? null,
    classifyModel: result.classifyModel ?? null,
  };
}
