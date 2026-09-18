import { NextResponse } from "next/server";

import { reportError } from "@/lib/errors/report";

/**
 * Erro para o cliente: mensagem genérica, sem internals.
 *
 * O `code` é opcional e é o único fio que liga esta resposta ao que o
 * servidor viu. Ele vai como **campo próprio** do JSON, e não só embutido na
 * frase: quem exibe precisa poder mostrar o código separado (copiável, com um
 * botão "Reportar" ao lado), e extrair isso de uma frase em português é
 * garantir que a interface quebre no dia em que alguém reescrever o texto.
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
