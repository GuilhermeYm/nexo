import { and, eq, inArray, ne } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";

import { markNoteForReading, readNote } from "@/lib/ai/note-reading";
import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { countTaskItems, richTextToPlain } from "@/lib/editor/document";
import { attachments, noteTags, notes, tags, workspaceWindows } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { getOwnedNotePreview } from "@/lib/notes/queries";
import { invalidateNoteListCache } from "@/lib/notes/cache";
import { createClient } from "@/lib/supabase/server";
import { updateNoteSchema } from "@/lib/validations/workspace";

const noteIdSchema = z.string().uuid();
const deleteNoteSchema = z.object({
  /** Arquivos associados só são removidos após escolha explícita no diálogo. */
  deleteAttachments: z.boolean().default(false),
  /** Tags são globais e só somem com escolha explícita depois de ver o
   *  impacto (`POST /api/notes/deletion-impact`). */
  deleteTags: z.boolean().default(false),
});
const BUCKET = "files";

async function removeStorageObjects(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: string[],
  userId: string
): Promise<void> {
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths.slice(index, index + 100));
    if (error) {
      await logServerError("DELETE /api/notes/[id] (storage)", error, {
        userId,
        pending: paths.length - index,
      });
      return;
    }
  }
}

/**
 * Conteúdo de leitura rápida para o acervo.
 *
 * A identidade da nota não é suficiente para conceder leitura: o id vindo da
 * rota é validado e a query sempre o cruza com a pessoa autenticada. Uma nota
 * de outra conta e uma inexistente devolvem a mesma resposta.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/notes/[id]">
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
      key: `notes:preview:${user.id}`,
      limit: 180,
      windowMs: 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas consultas seguidas. Aguarde um instante.");
    }

    const note = await getOwnedNotePreview(user.id, parsedId.data);
    if (!note) return errorResponse(404, "Nota não encontrada.");

    return NextResponse.json({ note });
  } catch (error) {
    const code = await logServerError("GET /api/notes/[id]", error, { userId }, request);
    return errorResponse(500, "Erro ao carregar a nota.", code);
  }
}

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
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

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

    // As caixas saem do mesmo documento, no mesmo lugar e pelo mesmo motivo
    // que o texto puro: o cliente não pode ser a fonte da verdade sobre o que
    // ele mesmo mandou. É o que faz o "5 de 7" da Agenda bater com as caixas
    // na tela mesmo diante de uma requisição forjada.
    //
    // Derivado para **toda** nota que manda documento, não só as da Agenda:
    // uma nota comum com caixas dentro é coisa real, custa uma travessia, e
    // uma condicional por tipo criaria um caminho onde os números envelhecem.
    // Nota em prosa fica em 0/0.
    const tally =
      input.contentRich !== undefined ? countTaskItems(input.contentRich) : null;

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
        ...(input.references !== undefined && { referenceLinks: input.references }),
        ...(input.font !== undefined && { font: input.font }),
        ...(tally !== null && { tasksTotal: tally.total, tasksDone: tally.done }),
        updatedAt: new Date(),
      })
      .where(scope)
      .returning({
        id: notes.id,
        userId: notes.userId,
        workspaceId: notes.workspaceId,
        title: notes.title,
        content: notes.content,
        source: notes.source,
        status: notes.status,
        taskDate: notes.taskDate,
      });

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

    await invalidateNoteListCache(user.id);

    // A IA lê a nota fora da resposta — a pessoa nunca espera por ela.
    // Marcar é barato (decide se mudou o bastante); ler só acontece quando o
    // editor avisa que a pessoa parou ou saiu (`?analyze=1`, mandado com
    // `keepalive` no fechamento da aba). Ver docs/IA.md.
    const analyze = new URL(request.url).searchParams.get("analyze") === "1";
    const ownerId = user.id;
    after(async function readNoteAfterSave() {
      await markNoteForReading(updated);
      if (analyze) await readNote(ownerId, updated.id, { request });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = await logServerError("PATCH /api/notes/[id]", error, { userId }, request);
    return errorResponse(500, "Erro ao salvar a nota.", code);
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
    const parsed = deleteNoteSchema.safeParse(
      await request.json().catch(() => ({}))
    );
    if (!parsed.success) return errorResponse(400, "Opção de exclusão inválida.");

    const limit = await rateLimit({
      key: `notes:delete:${user.id}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas exclusões seguidas. Aguarde um pouco.");
    }

    const result = await db.transaction(async (tx) => {
      const [removed] = await tx
        .update(notes)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(
          and(eq(notes.id, parsedId.data), eq(notes.userId, user.id), ne(notes.status, "deleted"))
        )
        .returning({ id: notes.id, title: notes.title });
      if (!removed) return null;

      // As tags saem antes dos vínculos: depois de apagar a nota a relação
      // ainda existe, e é dela que sai a lista do que apagar.
      const removedTags = parsed.data.deleteTags
        ? await tx
            .delete(tags)
            .where(
              and(
                eq(tags.userId, user.id),
                inArray(
                  tags.id,
                  tx
                    .select({ id: noteTags.tagId })
                    .from(noteTags)
                    .where(eq(noteTags.noteId, removed.id))
                )
              )
            )
            .returning({ id: tags.id, name: tags.name })
        : [];

      const removedAttachments = parsed.data.deleteAttachments
        ? await tx
            .delete(attachments)
            .where(
              and(eq(attachments.noteId, removed.id), eq(attachments.userId, user.id))
            )
            .returning({
              id: attachments.id,
              filename: attachments.filename,
              storagePath: attachments.storagePath,
            })
        : [];

      await tx
        .delete(workspaceWindows)
        .where(
          and(
            eq(workspaceWindows.noteId, removed.id),
            eq(workspaceWindows.userId, user.id)
          )
        );
      return { note: removed, attachments: removedAttachments, tags: removedTags };
    });

    if (!result) return errorResponse(404, "Nota não encontrada.");

    // Exclusão de conteúdo é exatamente o que a trilha de auditoria existe
    // para registrar — ao contrário do autosave, que ela não registra.
    await writeAuditLog({
      action: "DELETE",
      tableName: "notes",
      recordId: result.note.id,
      userId: user.id,
      oldData: { title: result.note.title },
      request,
    });
    await Promise.all(
      result.attachments.map((attachment) =>
        writeAuditLog({
          action: "DELETE",
          tableName: "attachments",
          recordId: attachment.id,
          userId: user.id,
          oldData: { filename: attachment.filename },
          request,
        })
      )
    );
    await Promise.all(
      result.tags.map((tag) =>
        writeAuditLog({
          action: "DELETE",
          tableName: "tags",
          recordId: tag.id,
          userId: user.id,
          oldData: { name: tag.name },
          request,
        })
      )
    );
    await removeStorageObjects(
      supabase,
      result.attachments.map((attachment) => attachment.storagePath),
      user.id
    );

    await invalidateNoteListCache(user.id);

    return NextResponse.json({
      ok: true,
      deletedAttachments: result.attachments.length,
      deletedTags: result.tags.length,
    });
  } catch (error) {
    const code = await logServerError("DELETE /api/notes/[id]", error, { userId }, request);
    return errorResponse(500, "Erro ao excluir a nota.", code);
  }
}
