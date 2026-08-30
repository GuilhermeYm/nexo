import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceConnections } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { listBoardConnections } from "@/lib/workspace/queries";
import { connectionLabelSchema } from "@/lib/validations/workspace";

/**
 * O que a flecha diz.
 *
 * A rota de coleção continua sem `PATCH` — origem e destino não se editam,
 * mudar a direção é apagar e ligar de novo. Esta rota existe para a **única**
 * coisa aqui dentro que é conteúdo: o rótulo. Ver 0012, que abriu a policy de
 * UPDATE com GRANT restrito a essa coluna.
 *
 * Sem auditoria, e de propósito: o rótulo é uma etiqueta de lousa, corrigida
 * enquanto se pensa. Auditar cada tecla afogaria os eventos que a tabela
 * existe para deixar visíveis — o mesmo critério do corpo da nota e do
 * fechamento de uma janela.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[id]/connections/[connectionId]">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    // O mesmo teto do salvamento de janela: o rótulo é debounced no cliente,
    // mas quem chamar a rota à mão não passa disso.
    const limit = await rateLimit({
      key: `connections:label:${user.id}`,
      limit: 600,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas edições seguidas. Aguarde um pouco.");
    }

    const { id: workspaceId, connectionId } = await ctx.params;
    // Antes de o id chegar ao `where`: um texto qualquer no lugar do uuid faz
    // o Postgres lançar `invalid input syntax`, que sai daqui como 500 — um
    // erro de servidor para o que é, na verdade, um endereço que não existe.
    if (!UUID.test(connectionId) || !UUID.test(workspaceId)) {
      return errorResponse(404, "Ligação não encontrada.");
    }

    const parsed = connectionLabelSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Dados inválidos."
      );
    }

    // O `where` é a autorização: dono, lousa e linha na mesma cláusula. Não
    // há leitura antes para conferir o dono — ela seria uma segunda ida ao
    // banco dizendo o que o `update` já recusa sozinho.
    const [updated] = await db
      .update(workspaceConnections)
      .set({ label: parsed.data.label })
      .where(
        and(
          eq(workspaceConnections.id, connectionId),
          eq(workspaceConnections.userId, user.id),
          eq(workspaceConnections.workspaceId, workspaceId)
        )
      )
      .returning({ id: workspaceConnections.id });

    if (!updated) return errorResponse(404, "Ligação não encontrada.");

    return NextResponse.json({
      connections: await listBoardConnections(user.id, workspaceId),
    });
  } catch (error) {
    logServerError(
      "PATCH /api/workspaces/[id]/connections/[connectionId]",
      error
    );
    return errorResponse(500, "Erro ao salvar o rótulo.");
  }
}
