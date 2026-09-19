import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";

import {
  BATCH_MAX_NOTES,
  classifyNote,
  classifyNotesBatch,
  isNoteAiConfigured,
} from "@/lib/ai/classify-note";
import type { TokenUsage } from "@/lib/ai/classify-document";
import { db } from "@/lib/db";
import {
  aiJobs,
  noteAiState,
  noteTagRejections,
  noteTags,
  notes,
  tags,
  type NoteAiStateValue,
} from "@/lib/db/schema";

type NoteTypeValue = NonNullable<(typeof noteAiState.$inferSelect)["suggestedType"]>;
import {
  EXTRA_READS_PER_RELEASE,
  type ReasoningEffort,
} from "@/lib/ai/preference-options";
import { getAiPreferences } from "@/lib/ai/preferences";
import { redactAndTrim } from "@/lib/errors/redact";
import { notifySystem } from "@/lib/inbox/notify";
import { reportError } from "@/lib/errors/report";
import { invalidateNoteListCache } from "@/lib/notes/cache";
import { rateLimit } from "@/lib/rate-limit";
import { paletteFromName } from "@/lib/tags/palette";

/**
 * A IA lê a nota que a pessoa escreveu: resume, sugere o tipo e marca.
 *
 * Três portas, uma engrenagem:
 *
 *  - `markNoteForReading` — chamado por quem **salva** a nota. Decide se
 *    mudou o bastante para valer uma leitura e, se sim, deixa a nota
 *    `pending` com uma tarefa `queued` no feed. Não chama modelo nenhum.
 *  - `readNote` — o trabalho em si, sempre dentro de `after()`. Tranca a nota,
 *    chama o modelo, grava tags e resumo, fecha a tarefa.
 *  - `sweepPendingNotes` — a rede de segurança do dashboard, para a nota
 *    cuja aba fechou antes de qualquer gatilho chegar.
 *
 * O que a IA **nunca** escreve aqui: `notes.title`, `notes.content`,
 * `notes.content_rich` — o texto é da pessoa — e nem `notes.type`, porque
 * qualquer UPDATE em `notes` dispara o trigger de `updated_at` e faria a nota
 * subir em Recentes sem a pessoa ter encostado. O tipo vira sugestão em
 * `note_ai_state.suggested_type`. Ver `docs/IA.md`.
 */

/* ---------------------------------------------------------------------- */
/* Limiares — a chamada mais barata é a que não acontece                   */
/* ---------------------------------------------------------------------- */

/** "comprar pão" não tem o que classificar. */
export const MIN_READ_CHARS = 120;
/** Abaixo disto a nota é marcada, mas não resumida. */
export const MIN_SUMMARY_CHARS = 600;
/** Mudou menos que isto desde a última leitura? Espera acumular. */
const DELTA_RATIO = 0.15;
/** …a menos que a mudança absoluta já seja grande. */
const DELTA_ABS_CHARS = 800;
/** Mudança pequena mas persistente também merece releitura, uma vez por dia. */
const STALE_READ_MS = 24 * 60 * 60 * 1000;
/** Uma nota viva editada o dia inteiro não vira vinte chamadas. */
export const MAX_RUNS_PER_DAY = 6;
/** Um worker que morreu no meio destrava a nota sozinho depois disto. */
const CLAIM_TTL_MS = 5 * 60 * 1000;
/** Recuo depois de falha do provedor: 1 min, 5 min, 30 min, desiste. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
/**
 * O resumo só é reescrito quando a nota mudou isto **desde o resumo** — entre
 * o piso de releitura (15%) e isto, a leitura só marca (`wantsSummary`).
 */
const SUMMARY_DRIFT_RATIO = 0.3;
const SUMMARY_DRIFT_ABS_CHARS = 1500;
/** …ou quando o resumo tem mais de uma semana e a nota mudou. */
const SUMMARY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Quantas candidatas a varredura olha por carga do dashboard. */
const SWEEP_CANDIDATES = 20;
/** Quantas leituras **com resumo** a varredura faz por carga (as só de tags vão em lote). */
const SWEEP_SINGLE_READS = 2;
/** A varredura não pega nota que ainda está sendo escrita em outra aba. */
const SWEEP_QUIET_MS = 2 * 60 * 1000;
/** Tags: reusar é o padrão, criar é a exceção. */
const MAX_NEW_TAGS_PER_READ = 2;
const MAX_AI_TAGS_PER_NOTE = 5;
/** O mesmo teto de `/api/notes/[id]/tags`. */
const MAX_TAGS_PER_NOTE = 20;
/** Quantas tags da pessoa vão no prompt como vocabulário. */
const VOCABULARY_SIZE = 40;
/**
 * Teto de leituras por pessoa por hora, somando todas as portas. Os gatilhos
 * vêm do cliente, e cliente é forjável: sem isto, alternar o texto de muitas
 * notas viraria chamadas pagas sem fim. Estourou, a nota fica `pending` e a
 * varredura a apanha depois.
 */
const MAX_READS_PER_HOUR = 60;
/** O stub do upload; nunca deve ser reusada como sugestão. */
const STUB_TAG = "a-classificar";

/* ---------------------------------------------------------------------- */
/* Hash e normalização                                                     */
/* ---------------------------------------------------------------------- */

/**
 * O texto como a IA o enxerga para decidir se mudou: sem acento, sem
 * pontuação, sem caixa, espaços colapsados. Corrigir uma vírgula, um acento
 * ou um espaço não muda o hash — e portanto não vale uma chamada.
 */
function normalizeForHash(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function hashNoteText(title: string, content: string): string {
  return createHash("sha256")
    .update(`${normalizeForHash(title)}\n${normalizeForHash(content)}`)
    .digest("hex");
}

/** Só o corpo: para achar outra nota com o mesmo texto e título diferente. */
export function hashNoteBody(content: string): string {
  return createHash("sha256").update(normalizeForHash(content)).digest("hex");
}

/**
 * O nome canônico de uma tag. Normalizado **no servidor**: o prompt pede
 * minúsculas sem acento, e o modelo desobedece. `Finanças`, `financas` e
 * `finanças ` viram a mesma coisa.
 */
export function normalizeTagName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function todayUtc(): string {
  // Dia UTC, e está certo: é um teto de custo, não uma data mostrada a
  // ninguém — a armadilha do fuso (`docs/AGENDA.md`) não se aplica.
  return new Date().toISOString().slice(0, 10);
}

function shortTitle(title: string): string {
  const clean = title.trim() || "Sem título";
  return clean.length > 80 ? `${clean.slice(0, 79)}…` : clean;
}

/* ---------------------------------------------------------------------- */
/* Marcar — quem salva a nota chama isto                                   */
/* ---------------------------------------------------------------------- */

export interface SavedNote {
  id: string;
  userId: string;
  workspaceId: string | null;
  title: string;
  content: string | null;
  source: "user" | "ai";
  status: "active" | "archived" | "deleted";
  taskDate: string | null;
}

/** A IA só lê o que é da pessoa, vivo, e não é lista da Agenda. */
function isReadable(note: SavedNote): boolean {
  return (
    note.source === "user" && note.status === "active" && note.taskDate === null
  );
}

/**
 * Mudou o bastante desde a última leitura?
 *
 * O piso de mudança é o que separa "a IA lê a nota" de "a IA lê a nota a
 * cada parágrafo". Uma nota longa escrita em três sessões deve custar uma ou
 * duas chamadas, não doze.
 */
function changedEnough(
  row: { contentHash: string | null; readChars: number; readAt: Date | null },
  chars: number
): boolean {
  if (!row.contentHash) return true;
  const delta = Math.abs(chars - row.readChars);
  if (delta >= DELTA_ABS_CHARS) return true;
  if (delta / Math.max(row.readChars, 1) >= DELTA_RATIO) return true;
  return row.readAt !== null && Date.now() - row.readAt.getTime() >= STALE_READ_MS;
}

/** O teto do dia, mais as leituras que a pessoa liberou hoje ("Ler mesmo assim"). */
function underDailyCap(row: {
  runsDay: string | null;
  runsCount: number;
  extraRuns: number;
}): boolean {
  return (
    row.runsDay !== todayUtc() || row.runsCount < MAX_RUNS_PER_DAY + row.extraRuns
  );
}

/**
 * A nota mudou o bastante para uma leitura, mas bateu o teto do dia.
 *
 * Registra **uma vez por dia** (`limit_hit_at`) e, conforme a escolha da
 * pessoa em Configurações → IA: `immediate` avisa agora na Entrada, com o
 * botão "Ler mesmo assim"; `daily` deixa para o resumo das 23 h (o
 * `pg_cron` de 0025 lê `limit_hit_at`); `off` só registra.
 *
 * O `dedupeKey` é a segunda trava: mesmo numa corrida, o índice único de
 * 0025 impede dois avisos da mesma nota no mesmo dia.
 */
async function noteLimitHit(
  note: SavedNote,
  row: { limitHitAt: Date | null }
): Promise<void> {
  const today = todayUtc();
  if (row.limitHitAt && row.limitHitAt.toISOString().slice(0, 10) === today) return;

  await setState(note.id, note.userId, { limitHitAt: new Date() });

  const { limitNotice } = await getAiPreferences(note.userId);
  if (limitNotice !== "immediate") return;

  await notifySystem({
    userId: note.userId,
    title: `“${shortTitle(note.title)}” chegou ao limite de leituras de hoje`,
    body: `A Nexo já leu esta nota ${MAX_RUNS_PER_DAY} vezes hoje e parou para não gastar à toa. O resumo e as tags ficam como estão até amanhã — ou libere mais leituras agora.`,
    metadata: {
      kind: "ai-limit",
      dedupeKey: `ai-limit:${note.id}:${today}`,
      href: `/nota/${note.id}`,
      action: {
        type: "ai-extra-reads",
        label: "Ler mesmo assim",
        noteIds: [note.id],
      },
    },
  });
}

/**
 * Apaga a tarefa de um ciclo que **nunca rodou**.
 *
 * A regra do `docs/DASHBOARD.md` é que nenhuma rotina apaga `ai_jobs`, e ela
 * continua valendo para o que aconteceu. Uma linha `queued` que a pessoa
 * desfez antes de a IA ler (voltou o texto ao que era, apagou a nota,
 * encolheu abaixo do piso) não é histórico de nada: é um aviso de algo que
 * não vai acontecer. O filtro por `status = 'queued'` é a garantia.
 */
async function dropQueuedJob(userId: string, jobId: string | null) {
  if (!jobId) return;
  await db
    .delete(aiJobs)
    .where(
      and(eq(aiJobs.id, jobId), eq(aiJobs.userId, userId), eq(aiJobs.status, "queued"))
    );
}

async function setState(
  noteId: string,
  userId: string,
  patch: Partial<typeof noteAiState.$inferInsert>
) {
  await db
    .update(noteAiState)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(noteAiState.noteId, noteId), eq(noteAiState.userId, userId)));
}

/**
 * Chamado depois de todo salvamento de nota. Barato: uma leitura e uma
 * escrita em `note_ai_state`, mais um INSERT em `ai_jobs` só quando um ciclo
 * novo começa. **Nunca lança** — salvar a nota não pode falhar por causa da
 * IA.
 */
export async function markNoteForReading(note: SavedNote): Promise<void> {
  try {
    if (!isReadable(note)) return;

    const content = note.content ?? "";
    const hash = hashNoteText(note.title, content);
    const chars = content.trim().length;

    await db
      .insert(noteAiState)
      .values({ noteId: note.id, userId: note.userId })
      .onConflictDoNothing();

    const [row] = await db
      .select()
      .from(noteAiState)
      .where(and(eq(noteAiState.noteId, note.id), eq(noteAiState.userId, note.userId)))
      .limit(1);
    if (!row) return;

    // Desligada nesta nota, ou lendo agora: só registra o que foi salvo.
    // Quem está lendo confere `dirty_hash` ao terminar e remarca se preciso.
    if (!row.enabled || row.state === "running") {
      if (row.dirtyHash !== hash) {
        await setState(note.id, note.userId, { dirtyHash: hash });
      }
      return;
    }

    let next: NoteAiStateValue;
    if (hash === row.contentHash) {
      // Voltou ao que a IA já leu: nada a fazer.
      next = row.contentHash ? "done" : "idle";
    } else if (chars < MIN_READ_CHARS) {
      next = "skipped";
    } else if (!isNoteAiConfigured()) {
      next = "waiting_configuration";
    } else if (
      row.state === "pending" ||
      // Desistiu depois das tentativas: a edição nova é a nova chance.
      (row.state === "failed" && row.nextAttemptAt === null && underDailyCap(row)) ||
      (changedEnough(row, chars) && underDailyCap(row))
    ) {
      next = "pending";
    } else {
      // Mudou pouco — ou mudou o bastante, mas o teto do dia chegou.
      next = row.state === "failed" ? "failed" : row.contentHash ? "done" : "idle";
      if (changedEnough(row, chars) && !underDailyCap(row)) {
        await noteLimitHit(note, row);
      }
    }

    if (next !== "pending") {
      if (row.state === "pending") await dropQueuedJob(note.userId, row.jobId);
      if (next !== row.state || row.dirtyHash !== hash) {
        await setState(note.id, note.userId, {
          state: next,
          dirtyHash: hash,
          ...(row.state === "pending" && { jobId: null }),
        });
      }
      return;
    }

    // Um ciclo, uma tarefa. Salvamentos seguidos reaproveitam a mesma linha.
    let jobId = row.state === "pending" ? row.jobId : null;
    if (!jobId) {
      const [job] = await db
        .insert(aiJobs)
        .values({
          userId: note.userId,
          workspaceId: note.workspaceId,
          noteId: note.id,
          kind: "summarize",
          status: "queued",
          label: `Ler “${shortTitle(note.title)}”`,
          detail: "A Nexo lê quando você terminar de escrever.",
        })
        .returning({ id: aiJobs.id });
      jobId = job.id;
    }

    // A condição no `where` é a tranca contra duas abas salvando juntas: só
    // uma consegue trocar o `job_id`; a outra apaga a tarefa que criou.
    const [claimed] = await db
      .update(noteAiState)
      .set({
        state: "pending",
        dirtyHash: hash,
        jobId,
        attempts: row.state === "pending" ? row.attempts : 0,
        nextAttemptAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(noteAiState.noteId, note.id),
          eq(noteAiState.userId, note.userId),
          row.jobId === null
            ? sql`${noteAiState.jobId} is null`
            : eq(noteAiState.jobId, row.jobId)
        )
      )
      .returning({ noteId: noteAiState.noteId });

    if (!claimed && jobId !== row.jobId) {
      await dropQueuedJob(note.userId, jobId);
    }
  } catch (error) {
    await reportError({
      route: "markNoteForReading",
      kind: "ai_job",
      error,
      userId: note.userId,
      context: { noteId: note.id },
    });
  }
}

/* ---------------------------------------------------------------------- */
/* Ler — sempre dentro de `after()`                                        */
/* ---------------------------------------------------------------------- */

/**
 * Tranca a nota para leitura. Zero linhas = outra aba/processo já pegou, ou
 * não há nada a fazer. Sem `SELECT ... FOR UPDATE` e sem fila: a condição do
 * UPDATE é a tranca.
 */
async function claim(userId: string, noteId: string) {
  const staleClaim = new Date(Date.now() - CLAIM_TTL_MS);
  const [row] = await db
    .update(noteAiState)
    .set({ state: "running", claimedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(noteAiState.noteId, noteId),
        eq(noteAiState.userId, userId),
        eq(noteAiState.enabled, true),
        or(
          eq(noteAiState.state, "pending"),
          and(
            eq(noteAiState.state, "failed"),
            sql`${noteAiState.nextAttemptAt} <= now()`
          ),
          and(eq(noteAiState.state, "running"), lt(noteAiState.claimedAt, staleClaim))
        )
      )
    )
    .returning();
  return row ?? null;
}

type ClaimedRow = NonNullable<Awaited<ReturnType<typeof claim>>>;

interface TagOutcome {
  added: string[];
  reused: string[];
  created: string[];
}

/**
 * Grava as tags sugeridas, com procedência `ai`.
 *
 * As quatro medidas contra a cauda de quase-duplicatas (`faculdade`,
 * `universidade`, `estudos`, `estudo`…): o vocabulário vai no prompt, o nome
 * é normalizado aqui, o casamento é pelo normalizado, e no máximo duas tags
 * inéditas por leitura.
 */
async function applyTags(
  userId: string,
  noteId: string,
  suggested: string[],
  userTags: { id: string; name: string }[]
): Promise<TagOutcome> {
  const outcome: TagOutcome = { added: [], reused: [], created: [] };

  const names = [...new Set(suggested.map(normalizeTagName))].filter(
    (name) => name.length > 0 && name !== STUB_TAG
  );
  if (names.length === 0) return outcome;

  const [onNote, rejected] = await Promise.all([
    db
      .select({ tagId: noteTags.tagId, source: noteTags.source })
      .from(noteTags)
      .where(eq(noteTags.noteId, noteId)),
    db
      .select({ tagId: noteTagRejections.tagId })
      .from(noteTagRejections)
      .where(
        and(eq(noteTagRejections.noteId, noteId), eq(noteTagRejections.userId, userId))
      ),
  ]);

  const present = new Set(onNote.map((row) => row.tagId));
  const refused = new Set(rejected.map((row) => row.tagId));
  let aiCount = onNote.filter((row) => row.source === "ai").length;
  let total = onNote.length;

  // O vocabulário, indexado pelo nome normalizado. A pessoa pode ter criado
  // "Finanças" à mão: ela casa com `financas` e é reusada, não duplicada.
  const byNormalized = new Map<string, { id: string; name: string }>();
  for (const tag of userTags) {
    const key = normalizeTagName(tag.name);
    if (key && !byNormalized.has(key)) byNormalized.set(key, tag);
  }

  const toLink: { id: string; name: string }[] = [];
  let newCount = 0;

  for (const name of names) {
    if (aiCount >= MAX_AI_TAGS_PER_NOTE || total >= MAX_TAGS_PER_NOTE) break;

    const existing = byNormalized.get(name);
    if (existing) {
      if (present.has(existing.id) || refused.has(existing.id)) continue;
      toLink.push(existing);
      outcome.reused.push(existing.name);
    } else {
      if (newCount >= MAX_NEW_TAGS_PER_READ) continue;
      const [created] = await db
        .insert(tags)
        .values({ userId, name, color: paletteFromName(name) })
        // Corrida com outra nota criando a mesma tag agora: reusa.
        .onConflictDoUpdate({ target: [tags.userId, tags.name], set: { name } })
        .returning({ id: tags.id, name: tags.name });
      if (present.has(created.id) || refused.has(created.id)) continue;
      byNormalized.set(name, created);
      toLink.push(created);
      outcome.created.push(created.name);
      newCount += 1;
    }
    present.add(toLink[toLink.length - 1].id);
    aiCount += 1;
    total += 1;
  }

  if (toLink.length) {
    // `onConflictDoNothing`: se a pessoa marcou a mesma tag nesse meio-tempo,
    // o vínculo dela (`user`) fica — a IA não rebaixa a procedência.
    await db
      .insert(noteTags)
      .values(toLink.map((tag) => ({ noteId, tagId: tag.id, source: "ai" as const })))
      .onConflictDoNothing();
    outcome.added = toLink.map((tag) => tag.name);
  }

  return outcome;
}

/** As tags da pessoa, das mais usadas para as menos. */
async function listUserTags(userId: string) {
  return db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .leftJoin(noteTags, eq(noteTags.tagId, tags.id))
    .where(eq(tags.userId, userId))
    .groupBy(tags.id)
    .orderBy(desc(sql`count(${noteTags.noteId})`), desc(tags.createdAt))
    .limit(1000);
}

function describeSuccess(
  summarized: boolean,
  summaryKept: boolean,
  outcome: TagOutcome
): string {
  const parts: string[] = [];
  if (summarized) parts.push("Resumiu");
  if (outcome.added.length) {
    parts.push(
      `${parts.length ? "marcou" : "Marcou"} com ${outcome.added.join(", ")}`
    );
  }
  const kept = summaryKept
    ? " O resumo continua o da versão anterior: a nota mudou pouco para reescrevê-lo."
    : "";
  if (parts.length === 0) return `Leu a nota; as tags que ela já tem bastam.${kept}`;
  return `${parts.join(" e ")}.${kept}`;
}

export interface ReadNoteOptions {
  /** De onde saem IP e user-agent do relatório de erro, quando há falha. */
  request?: Request | null;
}

/**
 * Uma nota trancada, conferida e com a tarefa já `running` — pronta para ir
 * ao modelo, sozinha ou num lote.
 */
interface ReadContext {
  userId: string;
  noteId: string;
  row: ClaimedRow;
  note: SavedNote;
  hash: string;
  chars: number;
  wantSummary: boolean;
  jobId: string;
  startedAt: Date;
}

/** O que a leitura produziu, venha de onde vier (uma nota, lote, gêmea). */
interface ReadingOutcome {
  summary: string | null;
  noteType: NoteTypeValue | null;
  tags: string[];
  provider: string | null;
  model: string | null;
  inputChars: number;
  truncated: boolean;
  usage: TokenUsage | null;
  /** Lida junto com outras notas numa chamada só. */
  batchSize?: number;
  /** Copiada de outra nota com o mesmo texto — zero tokens. */
  reused?: boolean;
}

async function loadSavedNote(userId: string, noteId: string): Promise<SavedNote | null> {
  const [note] = await db
    .select({
      id: notes.id,
      userId: notes.userId,
      workspaceId: notes.workspaceId,
      title: notes.title,
      content: notes.content,
      source: notes.source,
      status: notes.status,
      taskDate: notes.taskDate,
    })
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .limit(1);
  return note ?? null;
}

/**
 * O resumo precisa ser reescrito nesta leitura? (`docs/IA-LEITURA.md` §6.1,
 * "releitura só de tags")
 *
 * Reescrever o resumo é a parte mais cara da saída. Quando a nota mudou o
 * bastante para ser relida (15%) mas pouco desde o **resumo** (menos de 30%),
 * a leitura só marca: o resumo fica o da versão anterior, e a interface diz
 * isso. A pessoa pode pedir a reescrita ("Reler resumos" — `forceSummary`).
 */
export function wantsSummary(
  row: {
    summary: string | null;
    summaryChars: number | null;
    summaryAt: Date | null;
    forceSummary: boolean;
  },
  chars: number
): boolean {
  if (chars < MIN_SUMMARY_CHARS) return false;
  if (row.forceSummary || !row.summary || row.summaryChars === null) return true;
  const drift = Math.abs(chars - row.summaryChars);
  if (drift >= SUMMARY_DRIFT_ABS_CHARS) return true;
  if (drift / Math.max(row.summaryChars, 1) >= SUMMARY_DRIFT_RATIO) return true;
  return row.summaryAt !== null && Date.now() - row.summaryAt.getTime() >= SUMMARY_MAX_AGE_MS;
}

/** Põe a tarefa do ciclo em `running`, ou cria uma já rodando. */
async function startJob(
  userId: string,
  note: SavedNote,
  currentJobId: string | null,
  startedAt: Date
): Promise<string> {
  const label = `Lendo “${shortTitle(note.title)}”`;
  if (currentJobId) {
    const [running] = await db
      .update(aiJobs)
      .set({
        status: "running",
        label,
        detail: null,
        error: null,
        errorCode: null,
        startedAt,
      })
      .where(and(eq(aiJobs.id, currentJobId), eq(aiJobs.userId, userId)))
      .returning({ id: aiJobs.id });
    if (running) return running.id;
  }
  // A varredura, o recuo e o "Reler resumos" chegam sem tarefa (foi apagada,
  // ou o ciclo nasceu em `waiting_configuration`). Ela nasce aqui, rodando.
  const [job] = await db
    .insert(aiJobs)
    .values({
      userId,
      workspaceId: note.workspaceId,
      noteId: note.id,
      kind: "summarize",
      status: "running",
      label,
      startedAt,
    })
    .returning({ id: aiJobs.id });
  await setState(note.id, userId, { jobId: job.id });
  return job.id;
}

/**
 * Tranca, confere e prepara uma nota. `null` = não há o que ler agora — o
 * ciclo já foi encerrado aqui (nota apagada, texto igual, reaproveitada de
 * uma gêmea, sem orçamento). Nunca lança: falha vira `recordFailure`.
 */
async function prepareRead(
  userId: string,
  noteId: string,
  request: Request | null
): Promise<ReadContext | null> {
  let row: ClaimedRow | null = null;
  let jobId: string | null = null;

  try {
    row = await claim(userId, noteId);
    if (!row) return null;
    jobId = row.jobId;

    const note = await loadSavedNote(userId, noteId);

    // Apagada, arquivada, virou outra coisa: o ciclo acaba sem leitura.
    if (!note || !isReadable(note)) {
      await dropQueuedJob(userId, jobId);
      await setState(noteId, userId, {
        state: "idle",
        jobId: null,
        claimedAt: null,
        forceSummary: false,
      });
      return null;
    }

    const content = note.content ?? "";
    const hash = hashNoteText(note.title, content);
    const chars = content.trim().length;

    // Texto igual ao já lido só é relido quando a pessoa pediu o resumo.
    if ((hash === row.contentHash && !row.forceSummary) || chars < MIN_READ_CHARS) {
      await dropQueuedJob(userId, jobId);
      await setState(noteId, userId, {
        state: hash === row.contentHash ? "done" : "skipped",
        dirtyHash: hash,
        jobId: null,
        claimedAt: null,
        forceSummary: false,
      });
      return null;
    }

    if (!isNoteAiConfigured()) {
      // Marca e para. A varredura só volta a esta nota quando a chave
      // aparecer — numa instância que nunca vai ter IA, tentar a cada carga
      // do dashboard seria uma consulta inútil para sempre.
      await dropQueuedJob(userId, jobId);
      await setState(noteId, userId, {
        state: "waiting_configuration",
        dirtyHash: hash,
        jobId: null,
        claimedAt: null,
      });
      return null;
    }

    const wantSummary = wantsSummary(row, chars);
    const startedAt = new Date();

    // Antes do orçamento: reaproveitar não custa nada, e não deve gastar.
    if (await reuseTwinReading(userId, note, row, hash, chars, wantSummary, startedAt)) {
      return null;
    }

    // Depois da tranca, e não antes: gatilho que não achou nada a ler não
    // gasta o orçamento. Estourou, devolve a nota à fila como estava.
    const budget = await rateLimit({
      key: `ai:note-read:${userId}`,
      limit: MAX_READS_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    });
    if (!budget.success) {
      await setState(noteId, userId, { state: "pending", claimedAt: null });
      return null;
    }

    jobId = await startJob(userId, note, jobId, startedAt);
    return { userId, noteId, row, note, hash, chars, wantSummary, jobId, startedAt };
  } catch (error) {
    await recordFailure(userId, noteId, row, jobId, error, request);
    return null;
  }
}

/**
 * Outra nota da pessoa tem **exatamente** este texto e já foi lida? Copia a
 * leitura dela — resumo, tipo e tags — sem chamar o modelo
 * (`docs/IA-LEITURA.md` §6.1). Nota duplicada, colada, ou o modelo de
 * reunião repetido toda semana.
 *
 * Só serve se a gêmea tiver o que esta nota precisa: se esta quer resumo e a
 * gêmea não tem um do mesmo texto, a leitura segue para o modelo.
 */
async function reuseTwinReading(
  userId: string,
  note: SavedNote,
  row: ClaimedRow,
  hash: string,
  chars: number,
  wantSummary: boolean,
  startedAt: Date
): Promise<boolean> {
  const [twin] = await db
    .select({
      noteId: noteAiState.noteId,
      summary: noteAiState.summary,
      summaryHash: noteAiState.summaryHash,
      contentHash: noteAiState.contentHash,
      suggestedType: noteAiState.suggestedType,
    })
    .from(noteAiState)
    .innerJoin(
      notes,
      and(eq(notes.id, noteAiState.noteId), eq(notes.userId, noteAiState.userId))
    )
    .where(
      and(
        eq(noteAiState.userId, userId),
        eq(noteAiState.state, "done"),
        eq(noteAiState.bodyHash, hashNoteBody(note.content ?? "")),
        ne(noteAiState.noteId, note.id),
        ne(notes.status, "deleted")
      )
    )
    .orderBy(desc(noteAiState.readAt))
    .limit(1);
  if (!twin) return false;

  // O resumo da gêmea só serve se for do texto atual dela.
  const twinSummary =
    twin.summaryHash !== null && twin.summaryHash === twin.contentHash ? twin.summary : null;
  if (wantSummary && !twinSummary) return false;

  const twinTags = await db
    .select({ name: tags.name })
    .from(noteTags)
    .innerJoin(tags, eq(noteTags.tagId, tags.id))
    .where(and(eq(noteTags.noteId, twin.noteId), eq(tags.userId, userId)));

  const jobId = await startJob(userId, note, row.jobId, startedAt);
  const context: ReadContext = {
    userId,
    noteId: note.id,
    row,
    note,
    hash,
    chars,
    wantSummary,
    jobId,
    startedAt,
  };
  try {
    await finishRead(context, await listUserTags(userId), {
      summary: twinSummary,
      noteType: twin.suggestedType,
      tags: twinTags.map((tag) => tag.name),
      provider: null,
      model: null,
      inputChars: 0,
      truncated: false,
      usage: null,
      reused: true,
    });
  } catch (error) {
    // A tarefa já nasceu aqui: a falha tem de fechá-la, não a de antes.
    await failRead(context, error, null);
  }
  return true;
}

/**
 * Grava o que a leitura produziu: tags, resumo (se veio), tipo sugerido, a
 * tarefa `succeeded`. E remarca, se a pessoa escreveu enquanto o modelo lia.
 */
async function finishRead(
  context: ReadContext,
  userTags: { id: string; name: string }[],
  reading: ReadingOutcome
): Promise<void> {
  const { userId, noteId, row, note, hash, chars, jobId, startedAt } = context;

  const outcome = await applyTags(userId, noteId, reading.tags, userTags);
  const finishedAt = new Date();
  const today = todayUtc();
  // Resumo que não veio não apaga o antigo: ele fica, marcado "de uma versão
  // anterior" na interface, até a mudança acumular (`wantsSummary`).
  const summaryKept = reading.summary === null && row.summary !== null;

  await setState(noteId, userId, {
    state: "done",
    contentHash: hash,
    bodyHash: hashNoteBody(note.content ?? ""),
    readChars: chars,
    readAt: finishedAt,
    ...(reading.summary !== null && {
      summary: reading.summary,
      summaryHash: hash,
      summaryChars: chars,
      summaryAt: finishedAt,
    }),
    suggestedType: reading.noteType ?? row.suggestedType,
    forceSummary: false,
    claimedAt: null,
    attempts: 0,
    nextAttemptAt: null,
    jobId: null,
    // Reaproveitar não chamou o modelo: não conta no teto do dia.
    ...(!reading.reused && {
      runsDay: today,
      runsCount: row.runsDay === today ? row.runsCount + 1 : 1,
      // Leitura extra liberada vale só no dia em que foi liberada.
      extraRuns: row.runsDay === today ? row.extraRuns : 0,
    }),
  });

  // O `result` é legível pelo dono pelo PostgREST (SELECT-only desde 0005,
  // sem GRANT por coluna). **O texto da nota nunca entra aqui** — nem
  // trecho, nem resumo. O resumo mora em `note_ai_state`.
  const usage = reading.usage;
  const share = reading.batchSize ?? 1;
  await db
    .update(aiJobs)
    .set({
      status: "succeeded",
      label: `Leu “${shortTitle(note.title)}”`,
      detail: reading.reused
        ? "Outra nota sua tem o mesmo texto: a leitura dela foi reaproveitada, sem chamar o modelo."
        : describeSuccess(reading.summary !== null, summaryKept, outcome),
      result: {
        tagsAdded: outcome.added,
        tagsReused: outcome.reused,
        tagsCreated: outcome.created,
        typeSuggested: reading.noteType,
        summarized: reading.summary !== null,
        summaryKept,
        summaryChars: reading.summary?.length ?? 0,
        noteChars: chars,
        inputChars: reading.inputChars,
        truncated: reading.truncated,
        attempt: row.attempts + 1,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        provider: reading.provider,
        model: reading.model,
        ...(reading.reused && { reused: true, promptTokens: 0, completionTokens: 0 }),
        ...(reading.batchSize && { batchSize: reading.batchSize }),
        // O custo medido, não estimado. No lote, a parte desta nota: a
        // chamada inteira dividida igualmente (docs/IA-LEITURA.md §6.3).
        ...(usage && {
          promptTokens: Math.round(usage.prompt / share),
          completionTokens: Math.round(usage.completion / share),
          reasoningTokens:
            usage.reasoning === null ? null : Math.round(usage.reasoning / share),
          cachedTokens: usage.cached === null ? null : Math.round(usage.cached / share),
        }),
      },
      finishedAt,
    })
    .where(and(eq(aiJobs.id, jobId), eq(aiJobs.userId, userId)));

  // Só joga fora o cache de 45 s da lista quando algo mudou nela de fato:
  // tags novas, ou um resumo novo (a lista mostra o resumo no lugar do trecho).
  if (outcome.added.length || reading.summary !== null) {
    await invalidateNoteListCache(userId);
  }

  // A pessoa pode ter continuado escrevendo enquanto o modelo pensava.
  // Reavalia com o texto de agora: se mudou o bastante, um ciclo novo nasce.
  const latest = await loadSavedNote(userId, noteId);
  if (latest && hashNoteText(latest.title, latest.content ?? "") !== hash) {
    await markNoteForReading(latest);
  }
}

/**
 * Lê uma nota. Chame **só** dentro de `after()`: a pessoa nunca espera pela
 * IA. Nunca lança.
 */
export async function readNote(
  userId: string,
  noteId: string,
  options: ReadNoteOptions = {}
): Promise<void> {
  await readNotes(userId, [noteId], options);
}

/**
 * Lê várias notas, gastando o mínimo: a que tem gêmea é copiada, as que só
 * precisam de tags vão **juntas** em lotes de até `BATCH_MAX_NOTES` (a
 * abertura — regras e vocabulário — é paga uma vez por lote), e as que
 * precisam de resumo vão uma a uma. Chame só dentro de `after()`. Nunca
 * lança.
 */
export async function readNotes(
  userId: string,
  noteIds: string[],
  options: ReadNoteOptions = {}
): Promise<void> {
  const request = options.request ?? null;
  const ready: ReadContext[] = [];
  for (const noteId of [...new Set(noteIds)]) {
    const context = await prepareRead(userId, noteId, request);
    if (context) ready.push(context);
  }
  if (ready.length === 0) return;

  let userTags: { id: string; name: string }[];
  let preferences: Awaited<ReturnType<typeof getAiPreferences>>;
  try {
    [userTags, preferences] = await Promise.all([
      listUserTags(userId),
      getAiPreferences(userId),
    ]);
  } catch (error) {
    for (const context of ready) await failRead(context, error, request);
    return;
  }

  const knownTags = userTags
    .map((tag) => tag.name)
    .filter((name) => name !== STUB_TAG)
    .slice(0, VOCABULARY_SIZE);

  const singles = ready.filter((context) => context.wantSummary);
  const tagOnly = ready.filter((context) => !context.wantSummary);

  // Um lote de uma nota é só uma leitura com prompt diferente: vai sozinha.
  if (tagOnly.length < 2) {
    singles.push(...tagOnly);
  } else {
    for (let index = 0; index < tagOnly.length; index += BATCH_MAX_NOTES) {
      const chunk = tagOnly.slice(index, index + BATCH_MAX_NOTES);
      if (chunk.length === 1) singles.push(chunk[0]);
      else await readBatch(chunk, userTags, knownTags, preferences.reasoningEffort, request);
    }
  }

  for (const context of singles) {
    try {
      const reading = await classifyNote({
        reasoningEffort: preferences.reasoningEffort,
        title: context.note.title,
        text: context.note.content ?? "",
        knownTags,
        wantSummary: context.wantSummary,
      });
      await finishRead(context, userTags, reading);
    } catch (error) {
      await failRead(context, error, request);
    }
  }
}

async function readBatch(
  chunk: ReadContext[],
  userTags: { id: string; name: string }[],
  knownTags: string[],
  reasoningEffort: ReasoningEffort,
  request: Request | null
): Promise<void> {
  let batch: Awaited<ReturnType<typeof classifyNotesBatch>>;
  try {
    batch = await classifyNotesBatch(
      chunk.map((context) => ({
        title: context.note.title,
        text: context.note.content ?? "",
      })),
      { knownTags, reasoningEffort }
    );
  } catch (error) {
    for (const context of chunk) await failRead(context, error, request);
    return;
  }

  for (const [index, context] of chunk.entries()) {
    const reading = batch.readings[index];
    try {
      if (!reading) {
        // Só esta nota falha; o recuo a tenta de novo, sozinha ou noutro lote.
        throw new Error(`${batch.provider} não devolveu a leitura desta nota no lote`);
      }
      await finishRead(context, userTags, {
        summary: null,
        noteType: reading.noteType,
        tags: reading.tags,
        provider: batch.provider,
        model: batch.model,
        inputChars: reading.inputChars,
        truncated: reading.truncated,
        usage: batch.usage,
        batchSize: chunk.length,
      });
    } catch (error) {
      await failRead(context, error, request);
    }
  }
}

function failRead(context: ReadContext, error: unknown, request: Request | null) {
  return recordFailure(
    context.userId,
    context.noteId,
    context.row,
    context.jobId,
    error,
    request
  );
}

async function recordFailure(
  userId: string,
  noteId: string,
  row: ClaimedRow | null,
  jobId: string | null,
  error: unknown,
  request: Request | null
) {
  const message = error instanceof Error ? error.message : "Falha desconhecida.";
  const code = await reportError({
    route: "note reading worker",
    kind: "ai_job",
    error,
    userId,
    context: { noteId, attempt: (row?.attempts ?? 0) + 1 },
    request,
  });

  try {
    if (!row) return;
    const attempts = row.attempts + 1;
    const delay = BACKOFF_MS[attempts - 1];
    const retryAt = delay === undefined ? null : new Date(Date.now() + delay);

    // `failed` com `next_attempt_at` nulo = desistiu. Volta a tentar quando a
    // pessoa editar a nota de novo (`markNoteForReading` zera o contador).
    await setState(noteId, userId, {
      state: "failed",
      claimedAt: null,
      attempts,
      nextAttemptAt: retryAt,
    });

    if (jobId) {
      await db
        .update(aiJobs)
        .set({
          status: "failed",
          detail: retryAt
            ? `A nota continua como está; a Nexo tenta de novo em ${Math.round(
                (delay ?? 0) / 60_000
              )} min. Código ${code}.`
            : `Não conseguiu depois de ${attempts} tentativas. Edite a nota para tentar de novo, ou informe o código ${code}.`,
          error: redactAndTrim(message, 1000),
          errorCode: code,
          finishedAt: new Date(),
        })
        .where(and(eq(aiJobs.id, jobId), eq(aiJobs.userId, userId)));
    }
  } catch (updateError) {
    console.error("[AI] Não foi possível registrar falha de leitura de nota", {
      noteId,
      error: updateError instanceof Error ? updateError.message : "Unknown",
    });
  }
}

/* ---------------------------------------------------------------------- */
/* Varredura — a rede de segurança                                         */
/* ---------------------------------------------------------------------- */

/**
 * Pega as notas esperando leitura e as lê, gastando o mínimo: até
 * `BATCH_MAX_NOTES` que só precisam de tags vão **numa chamada só**, e no
 * máximo `SWEEP_SINGLE_READS` que precisam de resumo vão uma a uma.
 *
 * Roda em toda carga do dashboard, dentro de `after()`. A consulta usa o
 * índice parcial `note_ai_state_pending_idx` — nunca uma varredura da tabela.
 * Sem chave de IA configurada, nem consulta.
 */
export async function sweepPendingNotes(userId: string): Promise<void> {
  try {
    if (!isNoteAiConfigured()) return;

    const quietSince = new Date(Date.now() - SWEEP_QUIET_MS);
    const staleClaim = new Date(Date.now() - CLAIM_TTL_MS);

    const due = await db
      .select({
        noteId: noteAiState.noteId,
        state: noteAiState.state,
        summary: noteAiState.summary,
        summaryChars: noteAiState.summaryChars,
        summaryAt: noteAiState.summaryAt,
        forceSummary: noteAiState.forceSummary,
        // Qualificada à mão: coluna interpolada num `sql` não vem com a
        // tabela (a armadilha do AGENTS.md), e aqui há duas tabelas.
        chars: sql<number>`char_length(btrim(coalesce("notes"."content", '')))`,
      })
      .from(noteAiState)
      .innerJoin(
        notes,
        and(eq(notes.id, noteAiState.noteId), eq(notes.userId, noteAiState.userId))
      )
      .where(
        and(
          eq(noteAiState.userId, userId),
          eq(noteAiState.enabled, true),
          or(
            and(eq(noteAiState.state, "pending"), lt(noteAiState.updatedAt, quietSince)),
            and(
              eq(noteAiState.state, "failed"),
              sql`${noteAiState.nextAttemptAt} <= now()`
            ),
            and(eq(noteAiState.state, "running"), lt(noteAiState.claimedAt, staleClaim)),
            // A chave apareceu depois que a nota foi salva.
            eq(noteAiState.state, "waiting_configuration")
          )
        )
      )
      .orderBy(noteAiState.updatedAt)
      .limit(SWEEP_CANDIDATES);

    const withSummary = due
      .filter((row) => wantsSummary(row, Number(row.chars)))
      .slice(0, SWEEP_SINGLE_READS);
    const tagOnly = due
      .filter((row) => !wantsSummary(row, Number(row.chars)))
      .slice(0, BATCH_MAX_NOTES);
    const picked = [...tagOnly, ...withSummary];

    const waking = picked
      .filter((row) => row.state === "waiting_configuration")
      .map((row) => row.noteId);
    if (waking.length) {
      await db
        .update(noteAiState)
        .set({ state: "pending", updatedAt: new Date() })
        .where(
          and(
            eq(noteAiState.userId, userId),
            inArray(noteAiState.noteId, waking),
            eq(noteAiState.state, "waiting_configuration")
          )
        );
    }

    await readNotes(
      userId,
      picked.map((row) => row.noteId)
    );
  } catch (error) {
    await reportError({
      route: "sweepPendingNotes",
      kind: "ai_job",
      error,
      userId,
    });
  }
}

/* ---------------------------------------------------------------------- */
/* "Reler resumos" — a pessoa pediu                                        */
/* ---------------------------------------------------------------------- */

/** Quantas notas por pedido de "Reler resumos" — cada uma é uma chamada. */
export const SUMMARY_REFRESH_LIMIT = 20;

/**
 * As notas cujo resumo ficou de uma versão anterior porque a releitura foi só
 * de tags: a nota já foi lida no texto atual (`content_hash`), o resumo não
 * (`summary_hash`).
 */
function staleSummaryConditions(userId: string) {
  return and(
    eq(noteAiState.userId, userId),
    eq(noteAiState.enabled, true),
    eq(noteAiState.state, "done"),
    sql`${noteAiState.summary} is not null`,
    sql`${noteAiState.summaryHash} is distinct from ${noteAiState.contentHash}`,
    eq(notes.status, "active"),
    eq(notes.source, "user"),
    sql`"notes"."task_date" is null`
  );
}

export async function countStaleSummaries(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(noteAiState)
    .innerJoin(
      notes,
      and(eq(notes.id, noteAiState.noteId), eq(notes.userId, noteAiState.userId))
    )
    .where(staleSummaryConditions(userId));
  return row?.value ?? 0;
}

/**
 * Marca as notas de resumo velho para reescrita e devolve os ids, para quem
 * chama lê-las em `after()`. O pedido explícito passa por cima do teto diário
 * por nota — foi a pessoa quem pediu — mas não do teto por hora.
 */
export async function requestSummaryRefresh(userId: string): Promise<string[]> {
  const stale = await db
    .select({ noteId: noteAiState.noteId })
    .from(noteAiState)
    .innerJoin(
      notes,
      and(eq(notes.id, noteAiState.noteId), eq(notes.userId, noteAiState.userId))
    )
    .where(staleSummaryConditions(userId))
    .orderBy(desc(notes.updatedAt))
    .limit(SUMMARY_REFRESH_LIMIT);
  if (stale.length === 0) return [];

  const marked = await db
    .update(noteAiState)
    .set({ state: "pending", forceSummary: true, updatedAt: new Date() })
    .where(
      and(
        eq(noteAiState.userId, userId),
        inArray(
          noteAiState.noteId,
          stale.map((row) => row.noteId)
        ),
        // Só quem continua `done`: uma nota que virou `pending` ou `running`
        // no meio-tempo já vai ser lida pelo caminho normal.
        eq(noteAiState.state, "done")
      )
    )
    .returning({ noteId: noteAiState.noteId });
  return marked.map((row) => row.noteId);
}

/* ---------------------------------------------------------------------- */
/* Rejeição — a pessoa tirou uma tag da IA                                 */
/* ---------------------------------------------------------------------- */

/**
 * Registra que a pessoa não quer esta tag nesta nota, **se** quem a pôs foi
 * a IA. Tirar uma tag que ela mesma pôs não é recado para ninguém.
 */
export async function rememberTagRejection(
  userId: string,
  noteId: string,
  tagId: string,
  removedSource: "user" | "ai" | null
): Promise<void> {
  if (removedSource !== "ai") return;
  await db
    .insert(noteTagRejections)
    .values({ userId, noteId, tagId })
    .onConflictDoNothing();
}

/* ---------------------------------------------------------------------- */
/* "Ler mesmo assim" — a pessoa libera leituras além do teto do dia        */
/* ---------------------------------------------------------------------- */

/**
 * Libera `EXTRA_READS_PER_RELEASE` leituras a mais, hoje, em cada nota, e as
 * remarca — a que mudou o bastante volta a `pending`. Devolve os ids que
 * ficaram pendentes, para quem chama lê-los em `after()`.
 *
 * O teto por pessoa por hora (`MAX_READS_PER_HOUR`) **não** é liberado aqui:
 * ele é defesa contra cliente forjado, não economia, e continua valendo.
 */
export async function releaseExtraReads(
  userId: string,
  noteIds: string[]
): Promise<string[]> {
  if (noteIds.length === 0) return [];
  const today = todayUtc();

  await db
    .update(noteAiState)
    .set({
      extraRuns: sql`case when ${noteAiState.runsDay} = ${today}::date
        then ${noteAiState.extraRuns} + ${EXTRA_READS_PER_RELEASE}
        else ${noteAiState.extraRuns} end`,
      updatedAt: new Date(),
    })
    .where(and(eq(noteAiState.userId, userId), inArray(noteAiState.noteId, noteIds)));

  const saved = await db
    .select({
      id: notes.id,
      userId: notes.userId,
      workspaceId: notes.workspaceId,
      title: notes.title,
      content: notes.content,
      source: notes.source,
      status: notes.status,
      taskDate: notes.taskDate,
    })
    .from(notes)
    .where(and(eq(notes.userId, userId), inArray(notes.id, noteIds)));

  for (const note of saved) await markNoteForReading(note);

  const pending = await db
    .select({ noteId: noteAiState.noteId })
    .from(noteAiState)
    .where(
      and(
        eq(noteAiState.userId, userId),
        inArray(noteAiState.noteId, noteIds),
        eq(noteAiState.state, "pending")
      )
    );
  return pending.map((row) => row.noteId);
}
