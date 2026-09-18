import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { getNoteAiView } from "@/lib/notes/ai-view";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const noteIdSchema = z.string().uuid();

/**
 * O resumo e o estado da leitura por IA de uma nota.
 *
 * É o que o editor rebusca quando o Realtime avisa que `note_ai_state` mudou
 * — o evento é só o sino, a rota é o retrato (`docs/DASHBOARD.md`). Nota de
 * outra conta e nota nunca lida respondem igual: `{ ai: null }`.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/notes/[id]/ai">
) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const { id } = await ctx.params;
    const parsedId = noteIdSchema.safeParse(id);
    if (!parsedId.success) return errorResponse(400, "Nota inválida.");

    const limit = await rateLimit({
      key: `notes:ai-view:${user.id}`,
      limit: 240,
      windowMs: 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas consultas seguidas. Aguarde um instante.");
    }

    const ai = await getNoteAiView(user.id, parsedId.data);
    return NextResponse.json({ ai });
  } catch (error) {
    const code = await logServerError("GET /api/notes/[id]/ai", error, { userId }, request);
    return errorResponse(500, "Erro ao carregar o resumo.", code);
  }
}
