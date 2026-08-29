import { NextResponse } from "next/server";

/** Erro para o cliente: mensagem genérica, sem internals. */
export function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
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
