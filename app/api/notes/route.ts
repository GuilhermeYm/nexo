import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError, planLimitResponse } from "@/lib/api";
import { db } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import {
  countTaskItems,
  richDocumentSchema,
  richTextToPlain,
} from "@/lib/editor/document";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getNoteCaptureContext } from "@/lib/usage/queries";
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
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

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
    const context = await getNoteCaptureContext(user.id);

    // Teto de capturas do mês. A alavanca que separa Gratuito de Pro é
    // limite, e este é um dos que a página de planos promete: sem a checagem
    // aqui, "50 capturas por mês" seria decoração.
    if (context.captureQuota && !context.captureQuota.ok) {
      return planLimitResponse(
        409,
        `Você já fez as ${context.captureQuota.limit} capturas deste mês do plano Gratuito. No Pro elas são ilimitadas.`
      );
    }

    const tally =
      input.contentRich !== undefined
        ? countTaskItems(input.contentRich)
        : { total: 0, done: 0 };

    const [created] = await db
      .insert(notes)
      .values({
        // Do token, nunca do corpo.
        userId: user.id,
        workspaceId: context.homeWorkspaceId,
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
      .returning({ id: notes.id, title: notes.title });

    await invalidateNoteListCache(user.id);

    return NextResponse.json({ note: created }, { status: 201 });
  } catch (error) {
    const code = await logServerError("POST /api/notes", error, { userId }, request);
    return errorResponse(500, "Erro ao guardar a nota.", code);
  }
}

/** Título de emergência: a primeira linha do texto, cortada. */
function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}
