import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { listNotesByTag } from "@/lib/tags/queries";

/** O `tagId` vem da URL. Antes de virar comparação com uma coluna uuid, é texto. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/tags/[tagId]/notes">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const { tagId } = await ctx.params;
    // Id malformado e tag de outra pessoa recebem a mesma resposta: 404.
    // Confirmar que a tag existe já seria vazar informação.
    if (!UUID.test(tagId)) return errorResponse(404, "Tag não encontrada.");

    const limit = await rateLimit({
      key: `tags:notes:${user.id}`,
      limit: 120,
      windowMs: 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas consultas seguidas. Aguarde um instante.");
    }

    const notes = await listNotesByTag(user.id, tagId);
    if (!notes) return errorResponse(404, "Tag não encontrada.");

    return NextResponse.json({ notes });
  } catch (error) {
    logServerError("GET /api/tags/[tagId]/notes", error);
    return errorResponse(500, "Erro ao listar as notas da tag.");
  }
}
