import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { workspaceWindows } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { WindowContent } from "@/lib/workspace/queries";
import { updateWindowSchema } from "@/lib/validations/workspace";

/**
 * Uma janela.
 *
 * `PATCH` recebe o que mudou — geometria depois de um arraste, `zIndex`
 * depois de um clique, texto depois de uma edição. Nunca durante: o arraste
 * roda inteiro em estado do React e só chega aqui quando a pessoa solta.
 *
 * `DELETE` fecha a janela. **Fechar não é apagar**: a nota continua na conta,
 * achável pela busca e pelas tags. Apagar a nota é outra ação, em outro
 * lugar, e é ela — não esta — que gera audit log de exclusão de conteúdo.
 */

type Ctx = RouteContext<"/api/workspaces/[id]/windows/[windowId]">;

export async function PATCH(request: Request, ctx: Ctx) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    // Teto alto de propósito: arrastar dez janelas em sequência é uso
    // normal. O que ele barra é um laço automatizado.
    const limit = await rateLimit({
      key: `windows:update:${user.id}`,
      limit: 1_200,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas alterações seguidas. Aguarde um pouco.");
    }

    const { id: workspaceId, windowId } = await ctx.params;

    const parsed = updateWindowSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Dados inválidos."
      );
    }
    const input = parsed.data;

    const [current] = await db
      .select({
        kind: workspaceWindows.kind,
        content: workspaceWindows.content,
      })
      .from(workspaceWindows)
      .where(scopeOf(user.id, workspaceId, windowId))
      .limit(1);

    if (!current) return errorResponse(404, "Janela não encontrada.");

    // O conteúdo é um campo só no banco, então a atualização parcial é
    // resolvida aqui: mandar só `tone` não pode apagar o texto.
    const nextContent =
      input.text === undefined &&
      input.tone === undefined &&
      input.backgroundTone === undefined &&
      input.textTone === undefined
        ? undefined
        : mergeContent(current.content as WindowContent | null, input);

    if (nextContent !== undefined && current.kind === "note") {
      return errorResponse(
        400,
        "Uma janela de nota guarda o conteúdo na nota, não na janela."
      );
    }

    if (
      current.kind !== "text" &&
      (input.backgroundTone !== undefined || input.textTone !== undefined)
    ) {
      return errorResponse(
        400,
        "Só a caixa de texto tem fundo e cor de texto próprios."
      );
    }

    const [updated] = await db
      .update(workspaceWindows)
      // Campos listados um a um: o corpo validado nunca vira `values()`
      // inteiro, senão um campo novo do schema entraria por aí sem querer.
      .set({
        ...(input.x !== undefined && { x: input.x }),
        ...(input.y !== undefined && { y: input.y }),
        ...(input.width !== undefined && { width: input.width }),
        ...(input.height !== undefined && { height: input.height }),
        ...(input.zIndex !== undefined && { zIndex: input.zIndex }),
        ...(input.state !== undefined && { state: input.state }),
        ...(nextContent !== undefined && { content: nextContent }),
      })
      .where(scopeOf(user.id, workspaceId, windowId))
      .returning({ id: workspaceWindows.id });

    if (!updated) return errorResponse(404, "Janela não encontrada.");

    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = await logServerError("PATCH /api/workspaces/[id]/windows/[windowId]", error, { userId }, request);
    return errorResponse(500, "Erro ao atualizar a janela.", code);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const { id: workspaceId, windowId } = await ctx.params;

    const [removed] = await db
      .delete(workspaceWindows)
      .where(scopeOf(user.id, workspaceId, windowId))
      .returning({
        id: workspaceWindows.id,
        kind: workspaceWindows.kind,
        noteId: workspaceWindows.noteId,
      });

    if (!removed) return errorResponse(404, "Janela não encontrada.");

    // Um post-it fechado desaparece de verdade — não existe cópia dele em
    // lugar nenhum. Por isso ele é auditado e a janela de nota não é: nesta,
    // fechar não destrói nada.
    if (removed.kind !== "note") {
      await writeAuditLog({
        action: "DELETE",
        tableName: "workspace_windows",
        recordId: removed.id,
        userId: user.id,
        oldData: removed,
        request,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = await logServerError("DELETE /api/workspaces/[id]/windows/[windowId]", error, { userId }, request);
    return errorResponse(500, "Erro ao fechar a janela.", code);
  }
}

/* ---------------------------------------------------------------------- */

/**
 * O filtro que toda consulta desta rota usa.
 *
 * Os três termos juntos: a janela é desta pessoa, está nesta lousa e é esta.
 * Trocar o id do workspace na URL mantendo o id da janela não alcança nada.
 */
function scopeOf(userId: string, workspaceId: string, windowId: string) {
  return and(
    eq(workspaceWindows.id, windowId),
    eq(workspaceWindows.userId, userId),
    eq(workspaceWindows.workspaceId, workspaceId)
  );
}

function mergeContent(
  current: WindowContent | null,
  input: {
    text?: string;
    tone?: string;
    backgroundTone?: WindowContent["backgroundTone"];
    textTone?: WindowContent["textTone"];
  }
): WindowContent {
  return {
    text: input.text ?? current?.text ?? "",
    tone: input.tone ?? current?.tone ?? "1",
    backgroundTone:
      input.backgroundTone ?? current?.backgroundTone ?? "none",
    textTone: input.textTone ?? current?.textTone ?? "default",
  };
}
