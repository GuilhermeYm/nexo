import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { listTagGraph } from "@/lib/tags/queries";

/**
 * O grafo de tags e notas, carregado sob demanda.
 *
 * É separado da página porque a página de tags já carrega `listTagsWithUsage`
 * — pesar o carregamento inicial para quem nunca abre o grafo seria cobrar
 * de todos o que só alguns usam. O modo grafo é ativado por um botão na
 * interface e busca esta rota uma vez.
 *
 * `limit` é o teto de notas (nós) que o canvas consegue segurar. O cliente
 * mostra um aviso quando o grafo foi truncado.
 */
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export async function GET(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const parsed = querySchema.safeParse({
      limit: new URL(request.url).searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return errorResponse(400, "Limite inválido.");

    // Leitura leve, mas não de graça: teto generoso só para conter abuso.
    const limit = await rateLimit({
      key: `tags:graph:${user.id}`,
      limit: 120,
      windowMs: 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas consultas seguidas. Aguarde um instante.");
    }

    const graph = await listTagGraph(user.id, parsed.data.limit);
    return NextResponse.json(graph);
  } catch (error) {
    const code = await logServerError("GET /api/tags/graph", error, { userId }, request);
    return errorResponse(500, "Erro ao carregar o grafo.", code);
  }
}
