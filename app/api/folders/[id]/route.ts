import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { folders, noteFolders, noteTags, notes, tags, workspaceWindows } from "@/lib/db/schema";
import { folderNameTaken, getOwnedFolder } from "@/lib/folders/queries";
import { folderNameSchema } from "@/lib/folders/types";
import { invalidateNoteListCache } from "@/lib/notes/cache";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * Renomear e apagar uma pasta.
 *
 * **Renomear adota.** A pasta que a IA criou e a pessoa renomeou passa a ser
 * dela (`source = 'user'`) — é um sinal claro de que ela quer a pasta.
 *
 * **Apagar não apaga nota — a não ser que a pessoa peça.** O padrão é o de
 * sempre: as notas voltam para "sem pasta" (a FK de `note_folders` cascateia
 * a linha, não a nota), como fechar uma janela na lousa não apaga o conteúdo.
 * Com `notes: "delete"` no corpo, as notas contadas na pasta vão junto — a
 * mesma exclusão macia de `DELETE /api/notes/[id]` (`status = 'deleted'`),
 * com auditoria por nota. É uma escolha explícita no menu, nunca o padrão.
 * Com `tags: true` junto, as tags dessas notas também saem da conta; tag é
 * global, então o diálogo mostra o impacto antes (§ `deletion-impact`).
 *
 * "As notas contadas" é literal: o alvo é o mesmo conjunto que `listFolders`
 * soma e que o menu mostra à pessoa. Tarefas da Agenda (`task_date`) não
 * entram na conta, então também não entram na exclusão — apagar de repente o
 * dia de alguém que mandou apagar "3 notas" seria uma traição do número.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const renameSchema = z.object({ name: folderNameSchema });

/** O que fazer com as notas de dentro. Sem corpo, o padrão preserva. */
const deleteSchema = z.object({
  notes: z.enum(["keep", "delete"]).default("keep"),
  /** Só vale junto com `notes: "delete"`: as tags dessas notas também saem
   *  da conta. Escolha explícita, depois de ver o impacto. */
  tags: z.boolean().default(false),
});

async function authorize(key: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, error: errorResponse(401, "Não autenticado.") };

  const limit = await rateLimit({
    key: `${key}:${user.id}`,
    limit: 120,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.success) {
    return { user: null, error: errorResponse(429, "Muitas alterações. Aguarde um pouco.") };
  }
  return { user, error: null };
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/folders/[id]">) {
  let userId: string | null = null;
  try {
    const { user, error } = await authorize("folders:write");
    if (!user) return error;
    userId = user.id;

    const { id } = await ctx.params;
    if (!UUID.test(id)) return errorResponse(404, "Pasta não encontrada.");

    const parsed = renameSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(400, parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }
    const name = parsed.data.name;

    if (!(await getOwnedFolder(user.id, id))) {
      return errorResponse(404, "Pasta não encontrada.");
    }
    if ((await folderNameTaken(user.id, name, id)).taken) {
      return errorResponse(409, "Você já tem uma pasta com esse nome.");
    }

    const [folder] = await db
      .update(folders)
      .set({ name, source: "user", updatedAt: new Date() })
      .where(and(eq(folders.id, id), eq(folders.userId, user.id)))
      .returning({ id: folders.id, name: folders.name, source: folders.source });
    if (!folder) return errorResponse(404, "Pasta não encontrada.");

    await invalidateNoteListCache(user.id);
    return NextResponse.json({ folder });
  } catch (error) {
    const code = await logServerError("PATCH /api/folders/[id]", error, { userId }, request);
    // Corrida com outro nome igual: o índice único responde.
    if ((error as { code?: string })?.code === "23505") {
      return errorResponse(409, "Você já tem uma pasta com esse nome.");
    }
    return errorResponse(500, "Erro ao renomear a pasta.", code);
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/folders/[id]">) {
  let userId: string | null = null;
  try {
    const { user, error } = await authorize("folders:write");
    if (!user) return error;
    userId = user.id;

    const { id } = await ctx.params;
    if (!UUID.test(id)) return errorResponse(404, "Pasta não encontrada.");

    const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(400, "Opção de exclusão inválida.");
    const purge = parsed.data.notes === "delete";
    // Apagar tag sem apagar nota não faz sentido por esta porta: a tag é da
    // nota, não da pasta.
    const purgeTags = purge && parsed.data.tags;

    // Apagar notas em lote tem teto próprio, bem abaixo do de mexer em
    // pasta: é a operação mais destrutiva que esta rota oferece.
    if (purge) {
      const purgeLimit = await rateLimit({
        key: `folders:purge:${user.id}`,
        limit: 20,
        windowMs: 60 * 60 * 1000,
      });
      if (!purgeLimit.success) {
        return errorResponse(429, "Muitas exclusões seguidas. Aguarde um pouco.");
      }
    }

    const result = await db.transaction(async (tx) => {
      const doomed = purge
        ? await tx
            .select({ id: notes.id, title: notes.title })
            .from(noteFolders)
            .innerJoin(
              notes,
              and(
                eq(notes.id, noteFolders.noteId),
                eq(notes.userId, user.id),
                ne(notes.status, "deleted"),
                isNull(notes.taskDate)
              )
            )
            .where(and(eq(noteFolders.folderId, id), eq(noteFolders.userId, user.id)))
        : [];

      const [removed] = await tx
        .delete(folders)
        .where(and(eq(folders.id, id), eq(folders.userId, user.id)))
        .returning({ id: folders.id, name: folders.name });
      // Pasta de outra conta, ou já apagada: nada do que veio acima vale, e
      // a transação inteira volta atrás.
      if (!removed) return null;

      let doomedTags: { id: string; name: string }[] = [];
      if (doomed.length > 0) {
        const ids = doomed.map((note) => note.id);
        // As tags saem antes: depois de marcar as notas como apagadas o
        // vínculo ainda existe, e é dele que sai a lista do que apagar.
        if (purgeTags) {
          doomedTags = await tx
            .delete(tags)
            .where(
              and(
                eq(tags.userId, user.id),
                inArray(
                  tags.id,
                  tx
                    .select({ id: noteTags.tagId })
                    .from(noteTags)
                    .where(inArray(noteTags.noteId, ids))
                )
              )
            )
            .returning({ id: tags.id, name: tags.name });
        }
        await tx
          .update(notes)
          .set({ status: "deleted", updatedAt: new Date() })
          .where(and(inArray(notes.id, ids), eq(notes.userId, user.id)));
        // A janela na lousa some junto, como na exclusão de uma nota só.
        await tx
          .delete(workspaceWindows)
          .where(
            and(inArray(workspaceWindows.noteId, ids), eq(workspaceWindows.userId, user.id))
          );
      }
      return { folder: removed, notes: doomed, tags: doomedTags };
    });

    if (!result) return errorResponse(404, "Pasta não encontrada.");

    for (const note of result.notes) {
      await writeAuditLog({
        action: "DELETE",
        tableName: "notes",
        recordId: note.id,
        userId: user.id,
        oldData: { title: note.title, folder: result.folder.name },
        request,
      });
    }

    for (const tag of result.tags) {
      await writeAuditLog({
        action: "DELETE",
        tableName: "tags",
        recordId: tag.id,
        userId: user.id,
        oldData: { name: tag.name },
        request,
      });
    }

    await invalidateNoteListCache(user.id);
    return NextResponse.json({
      deleted: result.folder.id,
      deletedNotes: result.notes.length,
      deletedTags: result.tags.length,
    });
  } catch (error) {
    const code = await logServerError("DELETE /api/folders/[id]", error, { userId }, request);
    return errorResponse(500, "Erro ao apagar a pasta.", code);
  }
}
