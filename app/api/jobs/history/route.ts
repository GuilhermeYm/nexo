import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { historyQuerySchema, listJobHistory } from "@/lib/dashboard/job-history";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * O histórico completo de Tarefas, em páginas — a tela cheia do painel.
 *
 * `?status=all|succeeded|failed|active&kind=all|summarize|classify|transcribe&cursor=`
 * Os filtros são listas fechadas no Zod; o cursor vem da resposta anterior.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `jobs:history:${user.id}`,
      limit: 120,
      windowMs: 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas consultas seguidas. Aguarde um instante.");
    }

    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = historyQuerySchema.safeParse(params);
    if (!parsed.success) return errorResponse(400, "Filtro inválido.");

    return NextResponse.json(await listJobHistory(user.id, parsed.data));
  } catch (error) {
    const code = await logServerError("GET /api/jobs/history", error, { userId }, request);
    return errorResponse(500, "Erro ao carregar o histórico.", code);
  }
}
