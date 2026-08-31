import { NextResponse } from "next/server";

import { reportError } from "@/lib/errors/report";

/**
 * Erro para o cliente: mensagem genérica, sem internals.
 *
 * O `code` é opcional e é o único fio que liga esta resposta ao que o
 * servidor viu. Ele vai como **campo próprio** do JSON, e não só embutido na
 * frase: quem exibe precisa poder mostrar o código separado (copiável, com um
 * botão "Reportar" ao lado), e extrair isso de uma frase em português é
 * garantir que a interface quebre no dia em que alguém reescrever o texto —
 * exatamente o argumento que já vale para a marca `upgrade`.
 *
 * O código é opaco de propósito: quem o tem não ganha nada com ele. É seguro
 * exibir, ditar por telefone e colar num e-mail.
 */
export function errorResponse(status: number, message: string, code?: string) {
  return NextResponse.json(
    code ? { error: message, code } : { error: message },
    { status }
  );
}

/**
 * Recusa por **teto de plano** — não por erro.
 *
 * A diferença importa para quem está do outro lado. "Não foi possível enviar"
 * é um defeito: a pessoa tenta de novo, e falha de novo, sem saber por quê.
 * Bater no teto do Gratuito não é defeito nenhum — é o produto funcionando
 * como anunciado, e a resposta certa não é tentar de novo, é assinar (ou
 * esperar o mês virar).
 *
 * Por isso a marca `upgrade: true` vai no corpo: ela é o que permite a
 * interface trocar a cara de erro pelo convite, com o caminho para os planos.
 * O texto continua vindo pronto do servidor, porque é ele quem sabe qual teto
 * estourou e qual é o número dele.
 *
 * O status continua sendo o que o caso pede (409 para "não cabe mais", 413
 * para "não cabe este arquivo"): a marca informa a interface, não substitui o
 * protocolo.
 *
 * **Teto não vira relatório de erro.** Uma resposta daqui nunca passa por
 * `logServerError`, e é por isso que ela não tem código: `error_reports`
 * guarda defeito, e encher a tabela de recusas previstas afogaria justamente
 * o que ela existe para deixar visível.
 */
export function planLimitResponse(status: number, message: string) {
  return NextResponse.json({ error: message, upgrade: true }, { status });
}

/**
 * Log no servidor **e** relatório no banco. Devolve o código do relatório.
 *
 * O `console.error` acontece de forma síncrona, como sempre aconteceu, e a
 * gravação em `error_reports` corre depois. É por isso que a assinatura pôde
 * mudar de `void` para `Promise<string>` sem tocar em nenhum chamador antigo:
 * quem ignora o retorno continua tendo o log de sempre, na hora de sempre.
 * Quem quer o código — as rotas que vão devolvê-lo ao cliente — dá `await`:
 *
 * ```ts
 * } catch (error) {
 *   const code = await logServerError("/api/attachments", error, { userId }, request);
 *   return errorResponse(500, "Erro interno. Tente novamente.", code);
 * }
 * ```
 *
 * Esperar aqui é seguro: `reportError` nunca lança e tem prazo de 2s, então o
 * pior caso é a resposta de erro sair dois segundos mais tarde com um código
 * efêmero. O `userId` sai de `extra` para virar o dono da linha; o resto de
 * `extra` vira `context`, já filtrado.
 */
export function logServerError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>,
  request?: Request
): Promise<string> {
  console.error("[API_ERROR]", {
    context,
    error: error instanceof Error ? error.message : "Unknown",
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString(),
    ...extra,
  });

  const { userId, ...rest } = extra ?? {};

  return reportError({
    route: context,
    kind: "api",
    error,
    context: rest,
    userId: typeof userId === "string" ? userId : null,
    request: request ?? null,
  });
}

export function getClientIp(request: Request): string {
  // x-real-ip é sobrescrito pelo nginx da VPS, então o valor que o cliente
  // enviou não sobrevive ao proxy — já o x-forwarded-for é falsificável
  // quando não há proxy confiável na frente. Por isso x-real-ip tem
  // prioridade e o x-forwarded-for (primeiro IP da lista) fica de fallback.
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
