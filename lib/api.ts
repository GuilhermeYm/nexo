import { NextResponse } from "next/server";

/** Erro para o cliente: mensagem genérica, sem internals. */
export function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
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
 */
export function planLimitResponse(status: number, message: string) {
  return NextResponse.json({ error: message, upgrade: true }, { status });
}

/** Log detalhado no servidor; o cliente recebe apenas errorResponse(500, ...). */
export function logServerError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>
) {
  console.error("[API_ERROR]", {
    context,
    error: error instanceof Error ? error.message : "Unknown",
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString(),
    ...extra,
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
