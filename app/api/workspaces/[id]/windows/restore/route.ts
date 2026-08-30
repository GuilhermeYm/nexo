import { and, eq, inArray, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import {
  attachments,
  notes,
  workspaceConnections,
  workspaceWindows,
} from "@/lib/db/schema";
import { windowCapFor } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getBoardWriteContext, readBoard } from "@/lib/workspace/queries";
import {
  restoreWindowsSchema,
  type RestorableWindow,
} from "@/lib/validations/workspace";

/**
 * Desfazer uma apagada — o outro lado da borracha.
 *
 * O corpo é o que o `DELETE` em lote devolveu. As janelas voltam para onde
 * estavam, com o mesmo tamanho, o mesmo empilhamento, o mesmo conteúdo — e o
 * mesmo `id`.
 *
 * O id volta porque as flechas apontam para ele. Com id novo, as janelas
 * voltariam soltas e o "Desfazer" desfaria só metade do que a borracha fez.
 *
 * Sem esta rota a borracha seria um botão que destrói post-its sem rede de
 * proteção. Fechar uma nota é reversível pela própria conta (ela continua
 * lá, é só trazer de volta); um post-it apagado não existe em lugar nenhum,
 * e é para ele que o "Desfazer" existe.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[id]/windows/restore">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const limit = await rateLimit({
      key: `windows:restore:${user.id}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas restaurações seguidas. Aguarde um pouco.");
    }

    const { id: workspaceId } = await ctx.params;

    const parsed = restoreWindowsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Dados inválidos."
      );
    }

    // Dono do workspace, plano e contagem atual numa consulta só — a mesma
    // que a criação usa.
    const context = await getBoardWriteContext(user.id, workspaceId);
    if (!context) return errorResponse(404, "Workspace não encontrado.");

    // O que a pessoa ainda tem: uma nota excluída entre o apagar e o
    // desfazer não volta como janela, e a FK composta recusaria a linha de
    // qualquer forma. Filtrar antes troca um 500 de constraint por uma
    // restauração parcial que faz sentido — volta tudo o que ainda existe.
    const candidates = await keepWhatStillExists(
      user.id,
      parsed.data.windows ?? []
    );
    const links = parsed.data.connections ?? [];
    if (candidates.length === 0 && links.length === 0) {
      return errorResponse(404, "Nada disto existe mais para restaurar.");
    }

    // O teto do plano vale aqui como vale na criação: quem apagou uma lousa
    // cheia e encheu outra no meio-tempo não passa por baixo do limite pelo
    // caminho do desfazer.
    const cap = windowCapFor(context.plan);
    if (context.windowCount + candidates.length > cap) {
      return errorResponse(
        409,
        `Não cabe: esta lousa comporta ${cap} elementos.`
      );
    }

    if (candidates.length > 0) {
      await insertWindows(user.id, workspaceId, candidates);
    }

    await restoreConnections(user.id, workspaceId, links);

    return NextResponse.json(await readBoard(user.id, workspaceId));
  } catch (error) {
    logServerError("POST /api/workspaces/[id]/windows/restore", error);
    return errorResponse(500, "Erro ao restaurar as janelas.");
  }
}

/* ---------------------------------------------------------------------- */

/** As janelas de volta, com o id que tinham. */
async function insertWindows(
  userId: string,
  workspaceId: string,
  candidates: RestorableWindow[]
): Promise<void> {
  await db
    .insert(workspaceWindows)
    .values(
      candidates.map((row) => ({
        id: row.id,
        // Do token, nunca do corpo.
        userId,
        workspaceId,
        kind: row.kind,
        source: row.source,
        noteId: row.noteId ?? null,
        attachmentId: row.attachmentId ?? null,
        content: row.content ?? null,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
        zIndex: row.zIndex,
        state: row.state,
      }))
    )
    // A mesma nota pode ter sido reaberta noutro dispositivo entre o apagar e
    // o desfazer. O índice único recusa a segunda janela, e ignorar em
    // silêncio é a resposta certa: o que a pessoa queria de volta já está na
    // tela. Vale também para um Desfazer clicado duas vezes — a segunda não
    // duplica nada.
    .onConflictDoNothing();
}

/**
 * Devolve as flechas que sumiram por cascade.
 *
 * Depois das janelas, e nunca antes: as chaves estrangeiras exigem as duas
 * pontas de pé. E só as que ainda têm as duas — se uma das janelas não
 * voltou (a nota dela foi excluída no meio-tempo, por exemplo), a flecha não
 * tem onde encostar. Metade da lousa de volta é melhor resposta que um 500
 * de constraint.
 *
 * O conjunto de referência é lido do banco depois da inserção, e não montado
 * a partir do que a rota achou que inseriu: uma janela que caiu no
 * `onConflictDoNothing` também é ponta válida — ela está lá, só não foi esta
 * requisição que a pôs.
 */
async function restoreConnections(
  userId: string,
  workspaceId: string,
  connections: {
    fromWindowId: string;
    toWindowId: string;
    label?: string | null;
  }[]
): Promise<void> {
  if (connections.length === 0) return;

  const present = await db
    .select({ id: workspaceWindows.id })
    .from(workspaceWindows)
    .where(
      and(
        eq(workspaceWindows.userId, userId),
        eq(workspaceWindows.workspaceId, workspaceId)
      )
    );

  const live = new Set(present.map((row) => row.id));
  const usable = connections.filter(
    (row) => live.has(row.fromWindowId) && live.has(row.toWindowId)
  );
  if (usable.length === 0) return;

  await db
    .insert(workspaceConnections)
    .values(
      usable.map((row) => ({
        userId,
        workspaceId,
        fromWindowId: row.fromWindowId,
        toWindowId: row.toWindowId,
        // O texto escrito na flecha volta com ela.
        label: row.label ?? null,
      }))
    )
    .onConflictDoNothing();
}

/**
 * Descarta as janelas cujo alvo sumiu — ou nunca foi desta pessoa.
 *
 * Post-it e caixa de texto não apontam para nada e passam sempre. Nota e
 * anexo só voltam se a linha correspondente ainda existir na conta de quem
 * está pedindo: duas consultas, uma por tipo, em vez de uma por janela.
 */
async function keepWhatStillExists(
  userId: string,
  windows: RestorableWindow[]
): Promise<RestorableWindow[]> {
  const noteIds = [
    ...new Set(windows.map((row) => row.noteId).filter(isPresent)),
  ];
  const attachmentIds = [
    ...new Set(windows.map((row) => row.attachmentId).filter(isPresent)),
  ];

  const [ownedNotes, ownedAttachments] = await Promise.all([
    noteIds.length === 0
      ? []
      : db
          .select({ id: notes.id })
          .from(notes)
          .where(
            and(
              eq(notes.userId, userId),
              // Uma nota excluída no meio-tempo não volta como janela: a
              // exclusão dela é lógica, e a linha continua no banco.
              ne(notes.status, "deleted"),
              inArray(notes.id, noteIds)
            )
          ),
    attachmentIds.length === 0
      ? []
      : db
          .select({ id: attachments.id })
          .from(attachments)
          .where(
            and(
              eq(attachments.userId, userId),
              inArray(attachments.id, attachmentIds)
            )
          ),
  ]);

  const liveNotes = new Set(ownedNotes.map((row) => row.id));
  const liveAttachments = new Set(ownedAttachments.map((row) => row.id));

  return windows.filter((row) => {
    if (row.noteId) return liveNotes.has(row.noteId);
    if (row.attachmentId) return liveAttachments.has(row.attachmentId);
    return true;
  });
}

function isPresent(value: string | null | undefined): value is string {
  return typeof value === "string";
}
