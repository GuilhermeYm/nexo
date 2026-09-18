import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import {
  classifyNote,
  isNoteAiConfigured,
  type NoteReading,
} from "@/lib/ai/classify-note";
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
import { redactAndTrim } from "@/lib/errors/redact";
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
const MAX_RUNS_PER_DAY = 6;
/** Um worker que morreu no meio destrava a nota sozinho depois disto. */
const CLAIM_TTL_MS = 5 * 60 * 1000;
/** Recuo depois de falha do provedor: 1 min, 5 min, 30 min, desiste. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
/** Quantas notas a varredura do dashboard pega por carga. */
const SWEEP_BATCH = 2;
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

function underDailyCap(row: { runsDay: string | null; runsCount: number }): boolean {
  return row.runsDay !== todayUtc() || row.runsCount < MAX_RUNS_PER_DAY;
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
      // Mudou pouco: fica como está e espera acumular.
      next = row.state === "failed" ? "failed" : row.contentHash ? "done" : "idle";
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

function describeSuccess(reading: NoteReading, outcome: TagOutcome): string {
  const parts: string[] = [];
  if (reading.summary) parts.push("Resumiu");
  if (outcome.added.length) {
    parts.push(
      `${parts.length ? "marcou" : "Marcou"} com ${outcome.added.join(", ")}`
    );
  }
  if (parts.length === 0) return "Leu a nota; as tags que ela já tem bastam.";
  return `${parts.join(" e ")}.`;
}

export interface ReadNoteOptions {
  /** De onde saem IP e user-agent do relatório de erro, quando há falha. */
  request?: Request | null;
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
  let row: ClaimedRow | null = null;
  let jobId: string | null = null;
  const startedAt = new Date();

  try {
    row = await claim(userId, noteId);
    if (!row) return;

    // Depois da tranca, e não antes: gatilho que não achou nada a ler não
    // gasta o orçamento. Estourou, devolve a nota à fila como estava.
    const budget = await rateLimit({
      key: `ai:note-read:${userId}`,
      limit: MAX_READS_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    });
    if (!budget.success) {
      await setState(noteId, userId, { state: "pending", claimedAt: null });
      row = null;
      return;
    }
    jobId = row.jobId;

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

    // Apagada, arquivada, virou outra coisa: o ciclo acaba sem leitura.
    if (!note || !isReadable(note)) {
      await dropQueuedJob(userId, jobId);
      await setState(noteId, userId, { state: "idle", jobId: null, claimedAt: null });
      return;
    }

    const content = note.content ?? "";
    const hash = hashNoteText(note.title, content);
    const chars = content.trim().length;

    if (hash === row.contentHash || chars < MIN_READ_CHARS) {
      await dropQueuedJob(userId, jobId);
      await setState(noteId, userId, {
        state: hash === row.contentHash ? "done" : "skipped",
        dirtyHash: hash,
        jobId: null,
        claimedAt: null,
      });
      return;
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
      return;
    }

    const label = `Lendo “${shortTitle(note.title)}”`;
    if (jobId) {
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
        .where(and(eq(aiJobs.id, jobId), eq(aiJobs.userId, userId)))
        .returning({ id: aiJobs.id });
      if (!running) jobId = null;
    }
    if (!jobId) {
      // A varredura e o recuo chegam sem tarefa (foi apagada, ou o ciclo
      // nasceu em `waiting_configuration`). Ela nasce aqui, já rodando.
      const [job] = await db
        .insert(aiJobs)
        .values({
          userId,
          workspaceId: note.workspaceId,
          noteId,
          kind: "summarize",
          status: "running",
          label,
          startedAt,
        })
        .returning({ id: aiJobs.id });
      jobId = job.id;
      await setState(noteId, userId, { jobId });
    }

    const userTags = await listUserTags(userId);
    const reading = await classifyNote({
      title: note.title,
      text: content,
      knownTags: userTags
        .map((tag) => tag.name)
        .filter((name) => name !== STUB_TAG)
        .slice(0, VOCABULARY_SIZE),
      wantSummary: chars >= MIN_SUMMARY_CHARS,
    });

    const outcome = await applyTags(userId, noteId, reading.tags, userTags);
    const finishedAt = new Date();
    const today = todayUtc();

    await setState(noteId, userId, {
      state: "done",
      contentHash: hash,
      readChars: chars,
      readAt: finishedAt,
      summary: reading.summary,
      summaryHash: reading.summary ? hash : null,
      suggestedType: reading.noteType,
      claimedAt: null,
      attempts: 0,
      nextAttemptAt: null,
      jobId: null,
      runsDay: today,
      runsCount: row.runsDay === today ? row.runsCount + 1 : 1,
    });

    // O `result` é legível pelo dono pelo PostgREST (SELECT-only desde 0005,
    // sem GRANT por coluna). **O texto da nota nunca entra aqui** — nem
    // trecho, nem resumo. O resumo mora em `note_ai_state`.
    await db
      .update(aiJobs)
      .set({
        status: "succeeded",
        label: `Leu “${shortTitle(note.title)}”`,
        detail: describeSuccess(reading, outcome),
        result: {
          tagsAdded: outcome.added,
          tagsReused: outcome.reused,
          tagsCreated: outcome.created,
          typeSuggested: reading.noteType,
          summarized: reading.summary !== null,
          summaryChars: reading.summary?.length ?? 0,
          noteChars: chars,
          inputChars: reading.inputChars,
          truncated: reading.truncated,
          attempt: row.attempts + 1,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          provider: reading.provider,
          model: reading.model,
        },
        finishedAt,
      })
      .where(and(eq(aiJobs.id, jobId), eq(aiJobs.userId, userId)));

    // Só joga fora o cache de 45 s da lista quando algo mudou nela de fato.
    if (outcome.added.length) await invalidateNoteListCache(userId);

    // A pessoa pode ter continuado escrevendo enquanto o modelo pensava.
    // Reavalia com o texto de agora: se mudou o bastante, um ciclo novo nasce.
    const [latest] = await db
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
    if (latest && hashNoteText(latest.title, latest.content ?? "") !== hash) {
      await markNoteForReading(latest);
    }
  } catch (error) {
    await recordFailure(userId, noteId, row, jobId, error, options.request ?? null);
  }
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
 * Pega no máximo duas notas esperando leitura e as lê, em sequência.
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
      .select({ noteId: noteAiState.noteId, state: noteAiState.state })
      .from(noteAiState)
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
      .limit(SWEEP_BATCH);

    const waking = due
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

    for (const row of due) {
      await readNote(userId, row.noteId);
    }
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
