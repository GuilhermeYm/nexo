import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { searchOwnedAttachments } from "@/lib/attachments/queries";
import { searchNotes } from "@/lib/dashboard/queries";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { searchTags } from "@/lib/tags/queries";

// A query vai na URL, então é validada como todo o resto — e limitada em
// tamanho para ninguém mandar um romance para o to_tsquery.
const querySchema = z.object({
  q: z.string().trim().max(120),
  // `notes` para quem só lista notas (a tela de Tags): poupa a consulta dos
  // arquivos.
  scope: z.enum(["all", "notes", "tags"]).default("all"),
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

    const params = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({
      q: params.get("q") ?? "",
      scope: params.get("scope") ?? undefined,
    });
    // Busca vazia não é erro: é o estado inicial da barra de comando.
    if (!parsed.success) return NextResponse.json({ notes: [], files: [], tags: [] });

    // Busca é barata, mas não de graça: teto generoso só para conter abuso.
    const limit = await rateLimit({
      key: `search:${user.id}`,
      limit: 120,
      windowMs: 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas buscas seguidas. Aguarde um instante.");
    }

    const { q, scope } = parsed.data;
    if (!q && scope !== "tags") {
      return NextResponse.json({ notes: [], files: [], tags: [] });
    }

    if (scope === "tags") {
      return NextResponse.json({
        notes: [],
        files: [],
        tags: await searchTags(user.id, q),
      });
    }

    const [notes, files] = await Promise.all([
      searchNotes(user.id, q),
      scope === "all" ? searchOwnedAttachments(user.id, q) : [],
    ]);
    return NextResponse.json({ notes, files, tags: [] });
  } catch (error) {
    const code = await logServerError("GET /api/search", error, { userId }, request);
    return errorResponse(500, "Erro ao buscar.", code);
  }
}
