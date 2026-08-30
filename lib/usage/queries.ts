import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { type Plan, type PlanLimits, limitsFor } from "@/lib/plans";

/**
 * Leituras de consumo.
 *
 * Mesmo arranjo do dashboard e da lousa: as consultas vivem fora das rotas
 * porque tanto o Server Component das configurações quanto as rotas que
 * precisam barrar um free no teto usam as mesmas contas.
 *
 * **Uma ida ao banco por rota, não quatro.** Toda função aqui monta as contas
 * como subconsultas escalares penduradas na linha do perfil, em vez de fazer
 * uma consulta por número. A diferença não é teórica: a versão anterior lia o
 * plano, contava as notas, contava os anexos e só então buscava o workspace —
 * quatro viagens de ida e volta ao Supabase antes do INSERT, e o salvamento
 * do rascunho passou de um segundo. É a mesma lição que
 * `getBoardWriteContext` já tinha aprendido.
 *
 * O corte do mês é `date_trunc('month', now())`, do relógio do banco: o mesmo
 * para todo mundo, sem depender do fuso do runtime.
 *
 * Toda função recebe `userId` já derivado de `auth.getUser()`.
 */

/**
 * As subconsultas escalares recebem o `userId` como **parâmetro ligado**, e
 * não a coluna `profiles.id` interpolada.
 *
 * Isso não é preferência de estilo — é o que impede um bug silencioso. Ao
 * interpolar `${profiles.id}` num `sql` template, o Drizzle escreve a coluna
 * **sem qualificar a tabela**:
 *
 *     select w.id from workspaces w where w.user_id = "id"
 *
 * Dentro da subconsulta, esse `"id"` solto não resolve para `profiles.id` —
 * resolve para `w.id`, porque `workspaces` também tem uma coluna `id`. A
 * condição vira `w.user_id = w.id`, que nunca é verdadeira: a contagem volta
 * zero e o workspace volta nulo, **sem erro nenhum**. As cotas deixariam de
 * bloquear e ninguém ficaria sabendo.
 *
 * Com o uuid ligado como parâmetro não há nome para resolver errado.
 */

/**
 * Capturas do mês.
 *
 * "Captura" é nota escrita à mão **mais** arquivo enviado. Todo upload cria
 * uma nota também, então a contagem de notas exclui as que nasceram de um
 * anexo — senão o upload contaria duas vezes.
 *
 * Notas apagadas continuam contando: o teto é sobre o ato de capturar, não
 * sobre o que sobrou.
 */
function noteCaptures(userId: string) {
  return sql<number>`(
    select count(*)::int from notes n
    where n.user_id = ${userId}::uuid
      and n.created_at >= date_trunc('month', now())
      and not exists (select 1 from attachments a where a.note_id = n.id)
  )`;
}

function uploadCaptures(userId: string) {
  return sql<number>`(
    select count(*)::int from attachments a
    where a.user_id = ${userId}::uuid
      and a.created_at >= date_trunc('month', now())
  )`;
}

/** Soma dos arquivos guardados, em bytes. Acervo inteiro, não só o mês. */
function storageBytes(userId: string) {
  return sql<number>`(
    select coalesce(sum(a.size_bytes), 0)::float8 from attachments a
    where a.user_id = ${userId}::uuid
  )`;
}

function workspaceCount(userId: string) {
  return sql<number>`(
    select count(*)::int from workspaces w where w.user_id = ${userId}::uuid
  )`;
}

/**
 * O workspace onde uma nota solta nasce: o padrão, ou o mais antigo se o
 * padrão tiver sido excluído. Nulo continua achável pela busca, mas não
 * aparece em lousa nenhuma.
 */
function homeWorkspace(userId: string) {
  return sql<string | null>`(
    select w.id from workspaces w
    where w.user_id = ${userId}::uuid
    order by w.is_default desc, w.created_at
    limit 1
  )`;
}

export interface CaptureUsage {
  /** Notas escritas à mão — rascunho salvo ou nota criada na lousa. */
  notes: number;
  /** Arquivos enviados. */
  uploads: number;
  /** `notes + uploads` — é a soma que o teto mensal do plano limita. */
  total: number;
}

export interface QuotaCheck {
  /** `true` quando ainda cabe mais uma. */
  ok: boolean;
  /** Quanto já foi consumido. */
  used: number;
  /** O teto do plano. */
  limit: number;
}

/**
 * Monta a verificação a partir de um teto que pode não existir.
 *
 * `null` quando o plano não impõe teto (Pro) — quem chama trata isso como
 * "pode seguir".
 */
function quota(limit: number | null, used: number, incoming = 1): QuotaCheck | null {
  if (limit === null) return null;
  return { ok: used + incoming <= limit, used, limit };
}

/* ---------------------------------------------------------------------- */
/* O que cada rota precisa saber, numa consulta só                          */
/* ---------------------------------------------------------------------- */

export interface NoteCaptureContext {
  plan: Plan;
  captures: CaptureUsage;
  /** Onde a nota nasce. Pode ser nulo — a conta sem workspace nenhum. */
  homeWorkspaceId: string | null;
  /** `null` quando o plano não tem teto de capturas. */
  captureQuota: QuotaCheck | null;
}

/**
 * Tudo o que `POST /api/notes` precisa antes do INSERT: o plano, o consumo do
 * mês e o workspace de destino. Uma viagem ao banco.
 */
export async function getNoteCaptureContext(
  userId: string
): Promise<NoteCaptureContext> {
  const [row] = await db
    .select({
      plan: profiles.plan,
      notes: noteCaptures(userId),
      uploads: uploadCaptures(userId),
      homeWorkspaceId: homeWorkspace(userId),
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const plan = (row?.plan ?? "free") as Plan;
  const captures = countsOf(row);

  return {
    plan,
    captures,
    homeWorkspaceId: row?.homeWorkspaceId ?? null,
    captureQuota: quota(limitsFor(plan).capturesPerMonth, captures.total),
  };
}

export interface UploadQuotaContext {
  plan: Plan;
  captures: QuotaCheck | null;
  storage: QuotaCheck | null;
}

/**
 * Os dois tetos que um upload precisa respeitar, numa consulta só.
 *
 * O de capturas conta o mês; o de armazenamento soma o acervo inteiro e leva
 * em conta o arquivo que está chegando.
 */
export async function getUploadQuotaContext(
  userId: string,
  incomingBytes: number
): Promise<UploadQuotaContext> {
  const [row] = await db
    .select({
      plan: profiles.plan,
      notes: noteCaptures(userId),
      uploads: uploadCaptures(userId),
      storageBytes: storageBytes(userId),
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const plan = (row?.plan ?? "free") as Plan;
  const limits = limitsFor(plan);

  return {
    plan,
    captures: quota(limits.capturesPerMonth, countsOf(row).total),
    storage: quota(
      limits.storageBytes,
      Number(row?.storageBytes ?? 0),
      incomingBytes
    ),
  };
}

/**
 * O teto de capturas, para quem **já sabe o plano**.
 *
 * A rota da lousa é o caso: `getBoardWriteContext` já leu o plano no mesmo
 * SELECT que resolveu o dono do workspace, e reler seria desfazer justamente
 * a otimização que aquela função existe para fazer.
 *
 * A checagem e a inserção não são atômicas: dois pedidos simultâneos no limite
 * 49 podem ambos passar e a conta fechar em 51. É aceitável — fechar essa
 * fresta custaria uma transação segurando a linha do perfil durante a escrita
 * inteira, e o prejuízo de uma captura a mais é zero.
 */
export async function checkCaptureQuota(
  userId: string,
  plan: Plan | string
): Promise<QuotaCheck | null> {
  const limit = limitsFor(plan).capturesPerMonth;
  if (limit === null) return null;

  const { total } = await countMonthlyCaptures(userId);
  return quota(limit, total);
}

/** As capturas do mês, sozinhas. Uma consulta, duas subconsultas. */
export async function countMonthlyCaptures(
  userId: string
): Promise<CaptureUsage> {
  const [row] = await db
    .select({ notes: noteCaptures(userId), uploads: uploadCaptures(userId) })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  return countsOf(row);
}

/* ---------------------------------------------------------------------- */
/* A aba "Uso" das configurações                                           */
/* ---------------------------------------------------------------------- */

export interface UsageSnapshot {
  plan: Plan;
  limits: PlanLimits;
  workspaces: number;
  captures: CaptureUsage;
  storageBytes: number;
  /** ISO do primeiro instante do mês que vem — quando o contador zera. */
  capturesResetAt: string;
}

/** Tudo o que a aba "Uso" mostra — também numa consulta só. */
export async function getUsageSnapshot(userId: string): Promise<UsageSnapshot> {
  const [row] = await db
    .select({
      plan: profiles.plan,
      notes: noteCaptures(userId),
      uploads: uploadCaptures(userId),
      storageBytes: storageBytes(userId),
      workspaces: workspaceCount(userId),
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const plan = (row?.plan ?? "free") as Plan;

  return {
    plan,
    limits: limitsFor(plan),
    workspaces: row?.workspaces ?? 0,
    captures: countsOf(row),
    storageBytes: Number(row?.storageBytes ?? 0),
    capturesResetAt: firstOfNextMonthIso(),
  };
}

/* ---------------------------------------------------------------------- */

/** Soma as duas metades da captura, tolerando a linha ausente. */
function countsOf(
  row: { notes?: number; uploads?: number } | undefined
): CaptureUsage {
  const notes = row?.notes ?? 0;
  const uploads = row?.uploads ?? 0;
  return { notes, uploads, total: notes + uploads };
}

/** Primeiro dia do mês seguinte, 00:00 UTC — o mesmo corte de `date_trunc`. */
function firstOfNextMonthIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  ).toISOString();
}
