import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { errorReports } from "@/lib/db/schema";
import { mintErrorCode } from "@/lib/errors/code";
import { redactAndTrim, sanitizeContext } from "@/lib/errors/redact";

/**
 * Gravar um erro e devolver o código que a pessoa pode ditar.
 *
 * Este módulo é a única porta de escrita de `error_reports`. Na prática quem
 * chama é `logServerError` (`lib/api.ts`); as rotas só falam com ele direto
 * quando o `kind` não é `api`.
 *
 * ## Três contratos, e os três importam mais que o de costume
 *
 * **1. Nunca lança.** Já estamos dentro do `catch` de alguém. Uma exceção
 * aqui trocaria o erro real por um erro sobre o registro do erro — e é o
 * primeiro que a pessoa está esperando resposta sobre. Se falhar, sai um
 * `console.error` e um código efêmero: serve para a tela mostrar alguma coisa
 * e para o log ficar procurável por texto.
 *
 * **2. Nunca chama `logServerError`.** Ela chama aqui; a volta fecharia um
 * laço, e um laço no caminho de erro é como se derruba um servidor que já
 * está mal. Por isso o `console.error` deste arquivo é escrito à mão.
 *
 * **3. Tem prazo.** Se o banco é justamente o que quebrou, esperar a inserção
 * é esperar o tempo de conexão do `pg` — com a resposta ao usuário pendurada
 * junto. Dois segundos e a gente desiste: o erro original merece resposta
 * mais do que o relatório dele merece existir.
 *
 * ## O dedupe
 *
 * Um erro num caminho quente — a carga do dashboard — viraria centenas de
 * linhas idênticas, e a tabela de diagnóstico passaria a ser o problema. A
 * chave é `(fingerprint, dedupe_day)`: a primeira ocorrência do dia cunha o
 * código, as seguintes incrementam `occurrences` e empurram `last_seen_at`.
 *
 * A janela é o dia (UTC), e não "para sempre", porque a pergunta que o
 * suporte faz é "ainda está acontecendo?" — e um contador que soma três meses
 * não responde. Também não é por ocorrência: aí o código não agruparia nada.
 */

/** Espelha `error_report_kind` no banco. */
export type ErrorReportKind = "api" | "client" | "ai_job" | "unhandled";

export interface ReportErrorInput {
  /** `/api/attachments`, `dashboard/page`, `board:connect`… */
  route: string;
  kind: ErrorReportKind;
  /** O erro em si; a mensagem e o stack saem daqui. */
  error?: unknown;
  /** Alternativa a `error` quando só há texto (reporte vindo do cliente). */
  message?: string;
  stack?: string | null;
  /** Diagnóstico estruturado. Passa por `sanitizeContext` antes de gravar. */
  context?: Record<string, unknown> | null;
  /** Sempre do token. Nulo em fluxo não autenticado. */
  userId?: string | null;
  /**
   * O que a pessoa escreveu, quando ela reporta no mesmo gesto — o caminho do
   * error boundary, onde não existe código anterior para ela referenciar.
   *
   * Só `POST /api/errors` passa isto. Do lado do servidor o campo é sempre
   * nulo: a rota não sabe o que a pessoa estava fazendo, e inventar um relato
   * em nome dela seria pior que não ter nenhum.
   */
  userReport?: string | null;
  /** De onde saem IP e user-agent, como em `writeAuditLog`. */
  request?: Request | null;
}

const MAX_ROUTE = 200;
const MAX_MESSAGE = 4000;
const MAX_STACK = 8000;
/** O mesmo teto do CHECK em 0015 e do Zod da rota. */
const MAX_USER_REPORT = 2000;
/** O erro original espera; o relatório dele, não. */
const WRITE_TIMEOUT_MS = 2000;

export async function reportError(input: ReportErrorInput): Promise<string> {
  // O código é cunhado antes de qualquer outra coisa, e fora do `try`, de
  // propósito: se **nada** aqui dentro funcionar, ele ainda serve para a tela
  // mostrar algo e para o log sair procurável por texto.
  const code = mintErrorCode();
  const route = input.route.trim().slice(0, MAX_ROUTE) || "desconhecida";

  // O `try` cobre o preparo também, e não só a ida ao banco. `logServerError`
  // devolve esta promessa sem que a maioria dos chamadores dê `await` nela —
  // uma rejeição solta aqui derrubaria o processo pelo caminho de erro, que é
  // o pior lugar possível para isso acontecer.
  try {
    const message = redactAndTrim(
      input.message ?? describe(input.error),
      MAX_MESSAGE
    );
    const rawStack = input.stack ?? stackOf(input.error);
    const userId = input.userId ?? null;

    const userReport = input.userReport?.trim().slice(0, MAX_USER_REPORT) || null;

    const row = {
      userId,
      route,
      kind: input.kind,
      message: message || "(sem mensagem)",
      stack: rawStack ? redactAndTrim(rawStack, MAX_STACK) : null,
      context: sanitizeContext(input.context),
      fingerprint: fingerprintOf(input.kind, route, message, userId),
      userReport,
      userReportedAt: userReport ? new Date() : null,
      ipAddress: input.request ? clientIp(input.request) : null,
      userAgent: input.request?.headers.get("user-agent")?.slice(0, 300) ?? null,
    };

    const persisted = await withTimeout(persist(row, code), WRITE_TIMEOUT_MS);
    if (persisted) return persisted;

    // Efêmero: existe na resposta e no log, não na tabela. Procurar por ele
    // no banco volta vazio — e é isso que o suporte responde.
    console.error("[ERROR_REPORT] Código efêmero (fora da tabela)", {
      code,
      route,
      message: row.message,
      timestamp: new Date().toISOString(),
    });
    return code;
  } catch (failure) {
    // À mão, e não por `logServerError`: ela chama esta função.
    console.error("[ERROR_REPORT] Não foi possível gravar o relatório", {
      route,
      code,
      reason: failure instanceof Error ? failure.message : "Unknown",
      timestamp: new Date().toISOString(),
    });
    return code;
  }
}

/**
 * A inserção, com a colisão de `code` tratada.
 *
 * Duas chaves únicas convivem nesta tabela, e fazem coisas diferentes:
 * `(fingerprint, dedupe_day)` é o alvo do `ON CONFLICT` — o agrupamento —, e
 * `code` é só unicidade. Uma colisão de código não cai no `DO UPDATE`: ela
 * levanta 23505. Aí é sortear outro e tentar de novo, uma vez.
 */
async function persist(
  row: Omit<typeof errorReports.$inferInsert, "code">,
  firstCode: string
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const code = attempt === 0 ? firstCode : mintErrorCode();
    try {
      const [saved] = await db
        .insert(errorReports)
        .values({ ...row, code })
        .onConflictDoUpdate({
          target: [errorReports.fingerprint, errorReports.dedupeDay],
          set: {
            // Qualificado com o nome da tabela: dentro de um DO UPDATE o lado
            // direito enxerga tanto a linha existente quanto `excluded`, e
            // deixar isso implícito é o tipo de ambiguidade que só aparece no
            // dia em que alguém acrescenta uma coluna.
            occurrences: sql`error_reports.occurrences + 1`,
            lastSeenAt: new Date(),
            // O relato só entra quando veio um agora. Sem a condicional, a
            // segunda ocorrência de um erro já reportado apagaria o texto que
            // a pessoa escreveu na primeira — que é a coisa mais valiosa da
            // linha inteira.
            ...(row.userReport
              ? { userReport: row.userReport, userReportedAt: new Date() }
              : {}),
          },
        })
        // `returning` devolve o código da linha que ficou: o novo quando
        // inseriu, e o **já existente** quando agrupou. É isso que faz duas
        // ocorrências do mesmo erro darem o mesmo código para a pessoa.
        .returning({ code: errorReports.code });

      return saved?.code ?? null;
    } catch (error) {
      if (attempt === 0 && isCodeCollision(error)) continue;
      throw error;
    }
  }

  return null;
}

function isCodeCollision(error: unknown): boolean {
  const candidate = error as { code?: string; constraint?: string } | null;
  return (
    candidate?.code === "23505" &&
    (candidate.constraint ?? "").includes("error_reports_code")
  );
}

/**
 * A chave de agrupamento.
 *
 * O dono entra porque o mesmo defeito em duas contas são dois chamados
 * diferentes — e porque o código precisa ser reportável por quem o viu.
 *
 * A mensagem é normalizada antes: sem isso, "nota abc-123 não encontrada" e
 * "nota def-456 não encontrada" seriam erros distintos, e o dedupe deixaria
 * de agrupar justamente o caso que mais repete.
 */
function fingerprintOf(
  kind: string,
  route: string,
  message: string,
  userId: string | null
): string {
  const normalized = message
    .toLowerCase()
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      "<id>"
    )
    // Cinco dígitos ou mais: timestamps, tamanhos, offsets. Três e quatro
    // ficam — "respondeu 429" e "respondeu 503" são erros diferentes.
    .replace(/\b\d{5,}\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

  return createHash("sha256")
    .update(`${kind}|${route}|${normalized}|${userId ?? "anon"}`)
    .digest("hex");
}

/**
 * O stack, com o do `cause` logo abaixo quando existe.
 *
 * O stack de um `DrizzleQueryError` para dentro do próprio Drizzle — mostra
 * qual query rodou, não por que o Postgres a recusou. Quem sabe disso é o
 * `cause` (o erro que o `pg` levantou), então ele entra concatenado.
 */
function stackOf(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const own = error.stack ?? null;
  const cause = error.cause;
  if (cause instanceof Error && cause.stack && cause.stack !== own) {
    return own ? `${own}\n\nCausado por:\n${cause.stack}` : cause.stack;
  }
  return own;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const own =
      error.name === "Error" ? error.message : `${error.name}: ${error.message}`;

    // O Drizzle empacota toda falha de query num `DrizzleQueryError` cujo
    // `.message` é só "Failed query: <sql>\nparams: <valores>" — o motivo
    // real que o Postgres devolveu (sintaxe, timeout, conexão caída, coluna
    // inexistente…) fica em `error.cause`, e sem lê-lo a linha registra que
    // falhou sem dizer por quê. É a mesma forma que o `pg` usa para erros de
    // conexão do pool. Concatenar os dois é o que faz "Failed query: select…"
    // virar "Failed query: select… — syntax error in tsquery: \"/\"".
    const cause = error.cause;
    if (cause instanceof Error && cause.message && cause.message !== error.message) {
      return `${own} — ${cause.message}`;
    }

    return own;
  }
  if (typeof error === "string") return error;
  // Erros do Supabase e do `pg` chegam como objetos com `message`.
  const candidate = error as { message?: unknown } | null;
  if (typeof candidate?.message === "string") return candidate.message;
  return "Erro desconhecido";
}

/** Mesma regra de `getClientIp`, sem importar `lib/api` — que importa daqui. */
function clientIp(request: Request): string {
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Escrita do relatório passou de ${ms}ms`)),
        ms
      )
    ),
  ]);
}
