import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { searchNotes } from "@/lib/dashboard/queries";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

// A query vai na URL, então é validada como todo o resto — e limitada em
// tamanho para ninguém mandar um romance para o to_tsquery.
const querySchema = z.object({
  q: z.string().trim().min(1).max(120),
});

export async function GET(request: Request) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const parsed = querySchema.safeParse({
      q: new URL(request.url).searchParams.get("q") ?? "",
    });
    // Busca vazia não é erro: é o estado inicial da barra de comando.
    if (!parsed.success) return NextResponse.json({ notes: [] });

    // Busca é barata, mas não de graça: teto generoso só para conter abuso.
    const limit = await rateLimit({
      key: `search:${user.id}`,
      limit: 120,
      windowMs: 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas buscas seguidas. Aguarde um instante.");
    }

    return NextResponse.json({
      notes: await searchNotes(user.id, parsed.data.q),
    });
  } catch (error) {
    logServerError("GET /api/search", error);
    return errorResponse(500, "Erro ao buscar.");
  }
}
