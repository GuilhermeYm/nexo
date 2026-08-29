import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { notes, workspaces } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getOwnedWorkspace } from "@/lib/workspace/queries";

/**
 * Excluir um workspace.
 *
 * **O que some e o que fica.** O arranjo da lousa some — as janelas caem por
 * `ON DELETE CASCADE`, porque elas só existiam para dizer onde as coisas
 * estavam dentro deste workspace. As **notas ficam**: a coluna
 * `notes.workspace_id` é `ON DELETE SET NULL`, então elas apenas deixam de
 * pertencer a um workspace e continuam na conta, na busca e nas tags.
 *
 * Isso não é acidente do schema, é a regra do produto: reencontrar vale mais
 * que guardar, e nenhuma ação de organização pode destruir conteúdo. A
 * interface diz isso na confirmação, com o número de notas afetadas — que é
 * justamente o que esta rota devolve no `GET`.
 */

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/workspaces/[id]">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const { id } = await ctx.params;
    const workspace = await getOwnedWorkspace(user.id, id);
    if (!workspace) return errorResponse(404, "Workspace não encontrado.");

    return NextResponse.json({ workspace });
  } catch (error) {
    logServerError("GET /api/workspaces/[id]", error);
    return errorResponse(500, "Erro ao carregar o workspace.");
  }
}

const renameWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

/**
 * Renomear um workspace.
 *
 * Só o nome. Trocar o dono, o plano ou a marca de padrão por aqui seria
 * aceitar do cliente coisas que ele não tem por que decidir — o campo entra
 * um a um, nunca o corpo inteiro.
 *
 * A troca de nome **é auditada**: o nome é como a pessoa reencontra o que
 * guardou, e um renomeio que ninguém lembra de ter feito é indistinguível de
 * um sumiço. É o mesmo critério do título da nota em `PATCH /api/notes/[id]`
 * — audita-se o que muda a identidade da coisa, não cada tecla digitada.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[id]">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const limit = await rateLimit({
      key: `workspaces:rename:${user.id}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas alterações seguidas. Aguarde um pouco.");
    }

    const { id } = await ctx.params;
    const parsed = renameWorkspaceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(400, "O nome precisa ter de 1 a 60 caracteres.");
    }

    // O `id` vem da URL e por isso é entrada do cliente como qualquer outra.
    const current = await getOwnedWorkspace(user.id, id);
    if (!current) return errorResponse(404, "Workspace não encontrado.");

    const name = parsed.data.name;
    if (name === current.name) {
      return NextResponse.json({ workspace: current });
    }

    const [updated] = await db
      .update(workspaces)
      .set({ name, updatedAt: new Date() })
      // O filtro por `user_id` é redundante com a RLS e fica assim de
      // propósito: a rota não depende de a política estar certa para não
      // escrever na linha de outra pessoa.
      .where(and(eq(workspaces.id, id), eq(workspaces.userId, user.id)))
      .returning({ id: workspaces.id, name: workspaces.name });

    if (!updated) return errorResponse(404, "Workspace não encontrado.");

    await writeAuditLog({
      action: "UPDATE",
      tableName: "workspaces",
      recordId: id,
      userId: user.id,
      oldData: { name: current.name },
      newData: { name: updated.name },
      request,
    });

    return NextResponse.json({ workspace: updated });
  } catch (error) {
    logServerError("PATCH /api/workspaces/[id]", error);
    return errorResponse(500, "Erro ao renomear o workspace.");
  }
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[id]">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const { id } = await ctx.params;

    // Quantos workspaces a pessoa tem e quantas notas moram neste, numa
    // consulta só — as duas respostas são necessárias antes de apagar.
    const [context] = await db
      .select({
        total: sql<number>`count(*)::int`,
        noteCount: sql<number>`(
          select count(*)::int from ${notes}
          where ${notes.workspaceId} = ${id}
            and ${notes.userId} = ${user.id}
            and ${notes.status} <> 'deleted'
        )`,
      })
      .from(workspaces)
      .where(eq(workspaces.userId, user.id));

    // Zero workspaces é um estado que o produto não tem tela para mostrar: o
    // dashboard recriaria um padrão no próximo carregamento, e a pessoa
    // veria um workspace que ela não pediu no lugar do que ela apagou.
    if ((context?.total ?? 0) <= 1) {
      return errorResponse(
        409,
        "Você precisa de pelo menos um workspace. Crie outro antes de apagar este."
      );
    }

    const [removed] = await db
      .delete(workspaces)
      .where(and(eq(workspaces.id, id), eq(workspaces.userId, user.id)))
      .returning({ id: workspaces.id, name: workspaces.name });

    if (!removed) return errorResponse(404, "Workspace não encontrado.");

    await writeAuditLog({
      action: "DELETE",
      tableName: "workspaces",
      recordId: removed.id,
      userId: user.id,
      // O número de notas desvinculadas é o que alguém investigando isto
      // depois vai querer saber primeiro.
      oldData: { name: removed.name, unlinkedNotes: context?.noteCount ?? 0 },
      request,
    });

    return NextResponse.json({ ok: true, unlinkedNotes: context?.noteCount ?? 0 });
  } catch (error) {
    logServerError("DELETE /api/workspaces/[id]", error);
    return errorResponse(500, "Erro ao excluir o workspace.");
  }
}
