import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import {
  getOwnedWorkspace,
  listOpenableAttachments,
} from "@/lib/workspace/queries";

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
});

/**
 * Os arquivos que ainda dá para trazer para esta lousa.
 *
 * O par de `/notes`: aquela rota lista o que a IA escreveu **sobre** os
 * documentos, esta lista os documentos.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[id]/attachments">
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
    const workspace = await getOwnedWorkspace(user.id, id);
    if (!workspace) return errorResponse(404, "Workspace não encontrado.");

    const parsed = querySchema.safeParse({
      q: new URL(request.url).searchParams.get("q") ?? undefined,
    });
    if (!parsed.success) return errorResponse(400, "Busca inválida.");

    return NextResponse.json({
      attachments: await listOpenableAttachments(user.id, id, parsed.data.q),
    });
  } catch (error) {
    const code = await logServerError("GET /api/workspaces/[id]/attachments", error, { userId }, request);
    return errorResponse(500, "Erro ao carregar os arquivos.", code);
  }
}
