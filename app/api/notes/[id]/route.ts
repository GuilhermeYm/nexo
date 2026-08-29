import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { richTextToPlain } from "@/lib/editor/document";
import { notes, workspaceWindows } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { updateNoteSchema } from "@/lib/validations/workspace";

/**
 * Editar uma nota.
 *
 * É por aqui que a lousa salva o que a pessoa escreve dentro de uma janela.
 * A escrita é debounced no cliente: enquanto ela digita nada sai, e uns
 * segundos depois de parar vem um PATCH só.
 *
 * **Sobre auditoria.** O `AGENTS.md` manda registrar todo UPDATE em dado
 * sensível, e aqui isso precisa de leitura e não de obediência literal: um
 * autosave por parágrafo digitado encheria `audit_logs` de linhas sem
 * informação e faria a tabela de auditoria ficar maior que a de notas —
 * afogando exatamente os eventos que ela existe para deixar visíveis. Então
 * o registro é feito quando o **título** muda (renomear é a alteração que
 * alguém investigando uma conta invadida procura) e na exclusão, e não a
 * cada salvamento de corpo de texto.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/notes/[id]">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const limit = await rateLimit({
      key: `notes:update:${user.id}`,
      limit: 1_200,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas alterações seguidas. Aguarde um pouco.");
    }

    const { id } = await ctx.params;

    const parsed = updateNoteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Dados inválidos."
      );
    }
    const input = parsed.data;

    const scope = and(
      eq(notes.id, id),
      eq(notes.userId, user.id),
      ne(notes.status, "deleted")
    );

    const [current] = await db
      .select({ title: notes.title })
      .from(notes)
      .where(scope)
      .limit(1);

    if (!current) return errorResponse(404, "Nota não encontrada.");

    // O texto puro vem do documento sempre que ele existe. É o que mantém
    // `search_vector` e os resumos falando do mesmo conteúdo que o editor
    // mostra, sem depender de o cliente mandar os dois coerentes.
    const content =
      input.contentRich !== undefined
        ? richTextToPlain(input.contentRich)
        : input.content;

    const [updated] = await db
      .update(notes)
      // Campo a campo. O corpo validado nunca entra inteiro num `set()`:
      // `status`, `source` e `user_id` não são do cliente, e uma passagem
      // por espalhamento abriria a porta para eles no dia em que o schema
      // ganhasse mais um campo.
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(content !== undefined && { content }),
        ...(input.contentRich !== undefined && { contentRich: input.contentRich }),
        updatedAt: new Date(),
      })
      .where(scope)
      .returning({ id: notes.id, title: notes.title });

    if (!updated) return errorResponse(404, "Nota não encontrada.");

    if (input.title !== undefined && input.title !== current.title) {
      await writeAuditLog({
        action: "UPDATE",
        tableName: "notes",
        recordId: updated.id,
        userId: user.id,
        oldData: { title: current.title },
        newData: { title: updated.title },
        request,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logServerError("PATCH /api/notes/[id]", error);
    return errorResponse(500, "Erro ao salvar a nota.");
  }
}

/**
 * Excluir uma nota.
 *
 * É exclusão lógica: a linha ganha `status = 'deleted'` em vez de sumir do
 * banco. O schema já previa esse estado, e ele é o que permite investigar
 * depois — e, um dia, oferecer uma lixeira.
 *
 * As janelas que mostravam a nota são removidas de verdade. Elas são só o
 * arranjo; deixá-las apontando para conteúdo excluído faria a lousa exibir
 * uma janela que não tem mais o que mostrar.
 */
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/notes/[id]">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const { id } = await ctx.params;

    const [removed] = await db
      .update(notes)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(
        and(eq(notes.id, id), eq(notes.userId, user.id), ne(notes.status, "deleted"))
      )
      .returning({ id: notes.id, title: notes.title });

    if (!removed) return errorResponse(404, "Nota não encontrada.");

    await db
      .delete(workspaceWindows)
      .where(
        and(
          eq(workspaceWindows.noteId, id),
          eq(workspaceWindows.userId, user.id)
        )
      );

    // Exclusão de conteúdo é exatamente o que a trilha de auditoria existe
    // para registrar — ao contrário do autosave, que ela não registra.
    await writeAuditLog({
      action: "DELETE",
      tableName: "notes",
      recordId: removed.id,
      userId: user.id,
      oldData: { title: removed.title },
      request,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logServerError("DELETE /api/notes/[id]", error);
    return errorResponse(500, "Erro ao excluir a nota.");
  }
}
