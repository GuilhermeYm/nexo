import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";

import { markNoteForReading } from "@/lib/ai/note-reading";
import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { attachments, notes, workspaceWindows } from "@/lib/db/schema";
import {
  countTaskItems,
  richDocumentSchema,
  richTextToPlain,
} from "@/lib/editor/document";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getHomeWorkspaceId } from "@/lib/usage/queries";
import { NOTE_TYPES } from "@/lib/notes/list";
import { listOwnedNotes } from "@/lib/notes/queries";
import {
  invalidateNoteListCache,
  readNoteListCache,
  writeNoteListCache,
} from "@/lib/notes/cache";

/**
 * Cria uma nota fora de qualquer lousa.
 *
 * Existe por causa do rascunho do dashboard, que vive no navegador e só vem
 * para cá quando a pessoa manda. Diferente de
 * `POST /api/workspaces/[id]/windows`, aqui não nasce janela nenhuma: a nota
 * entra na conta e pronto. Quem quiser vê-la numa lousa a traz depois, pelo
 * "Trazer da conta".
 */

const createNoteSchema = z.object({
  title: z.string().trim().max(200).default(""),
  content: z.string().max(100_000).default(""),
  // O rascunho do dashboard hoje edita como nota cheia. Quando há documento,
  // ele é a fonte da verdade e o `content` acima é ignorado — o texto puro
  // sai derivado no servidor, mesma regra do `PATCH /api/notes/[id]`.
  contentRich: richDocumentSchema.optional(),
});

const listNotesSchema = z.object({
  q: z.string().trim().max(120).default(""),
  source: z.enum(["all", "user", "ai"]).default("all"),
  type: z.enum(["all", ...NOTE_TYPES]).default("all"),
  sort: z.enum(["updated", "created", "title"]).default("updated"),
  folder: z.union([z.enum(["all", "none"]), z.string().uuid()]).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

const deleteNotesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    "As notas selecionadas são inválidas."
  ),
  /** Arquivos são independentes por padrão; só somem com escolha explícita. */
  deleteAttachments: z.boolean().default(false),
});

const BUCKET = "files";

/**
 * O Storage não participa da transação do Postgres. Os metadados saem
 * primeiro, e uma falha aqui só deixa objetos órfãos privados — nunca uma
 * nota apontando para arquivo que já não existe. Mesmo contrato do reset da
 * conta, com lotes para não estourar o limite da API do Storage.
 */
async function removeStorageObjects(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: string[],
  userId: string
): Promise<void> {
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths.slice(index, index + 100));
    if (error) {
      await logServerError("DELETE /api/notes (storage)", error, {
        userId,
        pending: paths.length - index,
      });
      return;
    }
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const params = new URL(request.url).searchParams;
    const parsed = listNotesSchema.safeParse({
      q: params.get("q") ?? "",
      source: params.get("source") ?? "all",
      type: params.get("type") ?? "all",
      sort: params.get("sort") ?? "updated",
      folder: params.get("folder") ?? "all",
      page: params.get("page") ?? "1",
    });
    if (!parsed.success) return errorResponse(400, "Filtros inválidos.");

    const limit = await rateLimit({
      key: `notes:list:${user.id}`,
      limit: 180,
      windowMs: 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas consultas seguidas. Aguarde um instante.");
    }

    const options = {
      query: parsed.data.q,
      source: parsed.data.source,
      type: parsed.data.type,
      sort: parsed.data.sort,
      folder: parsed.data.folder,
      page: parsed.data.page,
    } as const;
    const cached = await readNoteListCache(user.id, options);
    if (cached.value) {
      return NextResponse.json(cached.value, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const result = await listOwnedNotes(user.id, options);
    await writeNoteListCache(user.id, options, cached.version, result);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const code = await logServerError("GET /api/notes", error, { userId }, request);
    return errorResponse(500, "Erro ao carregar as notas.", code);
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `notes:create:${user.id}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas notas criadas. Aguarde um pouco.");
    }

    const parsed = createNoteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Dados inválidos."
      );
    }
    const input = parsed.data;

    // O texto puro alimenta `search_vector` e os resumos: quando há documento,
    // ele vem derivado do documento e não do que o cliente mandou em
    // `content` — senão a busca indexaria uma coisa e o editor mostraria
    // outra.
    const content =
      input.contentRich !== undefined
        ? richTextToPlain(input.contentRich)
        : input.content;

    // Nota sem título e sem texto não é nota; é um clique errado. Recusar aqui
    // evita uma linha vazia permanente na conta de quem só encostou no botão.
    if (input.title.length === 0 && content.trim().length === 0) {
      return errorResponse(400, "Escreva um título ou um texto.");
    }

    // O plano, o consumo do mês e o workspace de destino numa consulta só.
    // Eram três em sequência, e a soma delas empurrou o salvamento do
    // rascunho para mais de um segundo — mesma armadilha que
    // `getBoardWriteContext` já tinha resolvido na lousa.
    //
    // O workspace de destino é o padrão, ou o mais antigo se o padrão tiver
    // sido excluído. Uma nota com `workspace_id` nulo continua achável pela
    // busca, mas não aparece em lousa nenhuma — é assim que conteúdo some de
    // vista sem ter sido apagado.
    const homeWorkspaceId = await getHomeWorkspaceId(user.id);
    const tally =
      input.contentRich !== undefined
        ? countTaskItems(input.contentRich)
        : { total: 0, done: 0 };

    const [created] = await db
      .insert(notes)
      .values({
        // Do token, nunca do corpo.
        userId: user.id,
        workspaceId: homeWorkspaceId,
        title: input.title || firstLine(content) || "Sem título",
        content,
        contentRich: input.contentRich ?? null,
        // O rascunho pode conter uma lista de tarefas, então os contadores
        // nascem certos aqui também — mesma derivação do PATCH.
        tasksTotal: tally.total,
        tasksDone: tally.done,
        type: "note",
        source: "user",
      })
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

    await invalidateNoteListCache(user.id);

    // O rascunho guardado na conta vira nota como as outras, e a IA passa a
    // vê-lo. Só marca: nota recém-criada ainda vai ser editada, e quem lê é o
    // editor quando a pessoa parar (ou a varredura do dashboard).
    after(async function markCreatedNote() {
      await markNoteForReading(created);
    });

    return NextResponse.json(
      { note: { id: created.id, title: created.title } },
      { status: 201 }
    );
  } catch (error) {
    const code = await logServerError("POST /api/notes", error, { userId }, request);
    return errorResponse(500, "Erro ao guardar a nota.", code);
  }
}

/**
 * Exclui, de uma vez, as notas selecionadas no acervo.
 *
 * A exclusão continua sendo lógica, como em `DELETE /api/notes/[id]`. O
 * escopo inclui o dono e `task_date IS NULL`: uma chamada forjada não pode
 * transformar as listas diárias da Agenda em itens apagáveis do acervo.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `notes:delete-batch:${user.id}`,
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas exclusões seguidas. Aguarde um pouco.");
    }

    const body = await request.json().catch(() => null);
    const parsed = deleteNotesSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Notas selecionadas inválidas."
      );
    }

    const { ids, deleteAttachments } = parsed.data;
    const removed = await db.transaction(async (tx) => {
      const removed = await tx
        .update(notes)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(
          and(
            inArray(notes.id, ids),
            eq(notes.userId, user.id),
            ne(notes.status, "deleted"),
            isNull(notes.taskDate)
          )
        )
        .returning({ id: notes.id, title: notes.title });
      const removedIds = removed.map((note) => note.id);
      const removedAttachments =
        deleteAttachments && removedIds.length > 0
          ? await tx
              .delete(attachments)
              .where(
                and(
                  inArray(attachments.noteId, removedIds),
                  eq(attachments.userId, user.id)
                )
              )
              .returning({
                id: attachments.id,
                filename: attachments.filename,
                storagePath: attachments.storagePath,
              })
          : [];
      // Janelas são apenas a apresentação da nota; deixá-las abertas para
      // conteúdo apagado produziria uma lousa inconsistente.
      await tx
        .delete(workspaceWindows)
        .where(
          and(
            inArray(workspaceWindows.noteId, ids),
            eq(workspaceWindows.userId, user.id)
          )
        );
      return { notes: removed, attachments: removedAttachments };
    });

    if (removed.notes.length === 0) return errorResponse(404, "Nenhuma nota encontrada.");

    await Promise.all(
      removed.notes.map((note) =>
        writeAuditLog({
          action: "DELETE",
          tableName: "notes",
          recordId: note.id,
          userId: user.id,
          oldData: { title: note.title },
          request,
        })
      )
    );
    await Promise.all(
      removed.attachments.map((attachment) =>
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
    await removeStorageObjects(
      supabase,
      removed.attachments.map((attachment) => attachment.storagePath),
      user.id
    );
    await invalidateNoteListCache(user.id);

    return NextResponse.json({
      ok: true,
      deleted: removed.notes.length,
      deletedAttachments: removed.attachments.length,
    });
  } catch (error) {
    const code = await logServerError("DELETE /api/notes", error, { userId }, request);
    return errorResponse(500, "Erro ao excluir as notas.", code);
  }
}

/** Título de emergência: a primeira linha do texto, cortada. */
function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}
