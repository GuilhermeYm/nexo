import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { getOwnedWorkspace, listOpenableNotes } from "@/lib/workspace/queries";

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
});

/**
 * As notas que ainda dá para trazer para esta lousa.
 *
 * Busca no sistema inteiro, não só neste workspace — o produto promete que a
 * pessoa consegue abrir aqui qualquer coisa que ela já guardou. As que já
 * estão abertas nesta lousa saem da lista.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[id]/notes">
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

    // Query string é entrada do cliente como qualquer outra.
    const parsed = querySchema.safeParse({
      q: new URL(request.url).searchParams.get("q") ?? undefined,
    });
    if (!parsed.success) return errorResponse(400, "Busca inválida.");

    return NextResponse.json({
      notes: await listOpenableNotes(user.id, id, parsed.data.q),
    });
  } catch (error) {
    const code = await logServerError("GET /api/workspaces/[id]/notes", error, { userId }, request);
    return errorResponse(500, "Erro ao carregar as notas.", code);
  }
}
