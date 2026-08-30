import { and, eq, inArray, or } from "drizzle-orm";
import { NextResponse } from "next/server";

import { errorResponse, logServerError, planLimitResponse } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
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
import { checkCaptureQuota } from "@/lib/usage/queries";
import {
  getBoardWriteContext,
  getOwnedWorkspace,
  readBoard,
} from "@/lib/workspace/queries";
import {
  DEFAULT_WINDOW_SIZE,
  clearWindowsSchema,
  createWindowSchema,
} from "@/lib/validations/workspace";

/**
 * As janelas de uma lousa.
 *
 * `GET` devolve o retrato inteiro — janelas **e** ligações, que é o que o
 * cliente rebusca quando o Realtime avisa que algo mudou em outro
 * dispositivo. As duas coisas vêm juntas de propósito: elas mudam juntas
 * (uma janela fechada leva as flechas dela por cascade), e dois retratos
 * tirados em momentos diferentes desenhariam flecha para janela que não
 * existe mais. `POST` abre uma janela nova; `DELETE` é a borracha.
 *
 * O `id` do workspace vem da URL e por isso é entrada do cliente como
 * qualquer outra: `getOwnedWorkspace` cruza com o usuário do token antes de
 * qualquer coisa, e devolve 404 (não 403) quando não é dele — confirmar que
 * o workspace existe já seria vazar informação.
 */

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/workspaces/[id]/windows">
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

    return NextResponse.json(await readBoard(user.id, id));
  } catch (error) {
    logServerError("GET /api/workspaces/[id]/windows", error);
    return errorResponse(500, "Erro ao carregar a lousa.");
  }
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[id]/windows">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const limit = await rateLimit({
      key: `windows:create:${user.id}`,
      limit: 240,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas janelas criadas. Aguarde um pouco.");
    }

    const { id: workspaceId } = await ctx.params;

    const parsed = createWindowSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(400, parsed.error.issues[0]?.message ?? "Dados inválidos.");
    }
    const input = parsed.data;

    // Dono do workspace, plano, contagem para o teto e topo da pilha numa
    // consulta só. Eram quatro em sequência, e a soma delas atrasava a
    // criação a ponto de a pessoa clicar em "Nova nota" e começar a digitar
    // antes de a janela existir para receber o texto.
    const context = await getBoardWriteContext(user.id, workspaceId);
    if (!context) return errorResponse(404, "Workspace não encontrado.");

    // Teto do plano. A alavanca que separa Gratuito de Pro é esta — não onde
    // o dado mora.
    // Teto de elementos da lousa. No Gratuito ele é do plano; no Pro, o teto
    // absoluto anti-abuso — que não é oferta e por isso não convida a assinar.
    const cap = windowCapFor(context.plan);
    if (context.windowCount >= cap) {
      const message = `Esta lousa chegou ao limite de ${cap} elementos.`;
      return context.plan === "free"
        ? planLimitResponse(
            409,
            `${message} No Pro a lousa não tem esse teto.`
          )
        : errorResponse(409, message);
    }

    // Criar uma nota nova aqui é uma captura, e conta contra o teto mensal do
    // plano. Abrir uma nota que já existe (`noteId`), um anexo, um post-it ou
    // uma caixa de texto não cria captura nenhuma — nada disso é barrado.
    //
    // O plano vem de `context`: ele já foi lido no mesmo SELECT que resolveu o
    // dono do workspace, e reler seria uma terceira ida ao banco no caminho
    // que esta rota justamente reduziu a uma.
    if (input.kind === "note" && input.title && !input.noteId) {
      const quota = await checkCaptureQuota(user.id, context.plan);
      if (quota && !quota.ok) {
        return planLimitResponse(
          409,
          `Você já fez as ${quota.limit} capturas deste mês do plano Gratuito. No Pro elas são ilimitadas.`
        );
      }
    }

    const size = DEFAULT_WINDOW_SIZE[input.kind];

    const noteId =
      input.kind === "note"
        ? await resolveNoteId(user.id, workspaceId, input)
        : null;

    if (input.kind === "note" && noteId === null) {
      return errorResponse(404, "Nota não encontrada.");
    }

    // A FK composta `(attachment_id, user_id)` recusaria um anexo de outra
    // pessoa de qualquer forma, mas um 404 explicado é melhor resposta que um
    // 500 de constraint.
    let attachmentId: string | null = null;
    if (input.kind === "attachment") {
      const [owned] = await db
        .select({ id: attachments.id })
        .from(attachments)
        .where(
          and(
            eq(attachments.id, input.attachmentId!),
            eq(attachments.userId, user.id)
          )
        )
        .limit(1);

      if (!owned) return errorResponse(404, "Arquivo não encontrado.");
      attachmentId = owned.id;
    }

    const [created] = await db
      .insert(workspaceWindows)
      .values({
        // Do token, nunca do corpo.
        userId: user.id,
        workspaceId,
        noteId,
        attachmentId,
        kind: input.kind,
        source: "user",
        content:
          input.kind === "sticky" || input.kind === "text"
            ? { text: input.text ?? "", tone: input.tone ?? "1" }
            : null,
        x: input.x ?? context.nextX,
        y: input.y ?? context.nextY,
        width: input.width ?? size.width,
        height: input.height ?? size.height,
        zIndex: context.nextZ,
      })
      .returning({ id: workspaceWindows.id });

    // A resposta é a lousa inteira relida, e não a linha que acabou de
    // entrar: o cliente aplica um retrato consistente em vez de remendar a
    // lista com um objeto montado por ele. Mesmo princípio do dashboard.
    return NextResponse.json(
      {
        windowId: created.id,
        ...(await readBoard(user.id, workspaceId)),
      },
      { status: 201 }
    );
  } catch (error) {
    // Índice único de (workspace_id, note_id) ou (workspace_id,
    // attachment_id): já está aberto nesta lousa.
    if (isUniqueViolation(error)) {
      return errorResponse(409, "Isto já está aberto nesta lousa.");
    }

    logServerError("POST /api/workspaces/[id]/windows", error);
    return errorResponse(500, "Erro ao abrir a janela.");
  }
}

/** Quantos elementos apagados entram no audit log de uma limpeza. */
const AUDIT_SAMPLE = 100;

/**
 * A borracha: apaga janelas em lote.
 *
 * Sem corpo (ou com `{}`), limpa a lousa inteira. Com `{ ids }`, apaga o que
 * a borracha encostou num gesto — o cliente junta os ids enquanto o dedo
 * passa e manda uma requisição só quando solta, no mesmo princípio do
 * arraste.
 *
 * **Apagar aqui é fechar.** Uma janela de nota ou de anexo some da lousa e a
 * nota (ou o arquivo) continua na conta, achável pela busca e pelas tags. Só
 * o post-it e a caixa de texto somem de verdade — eles nunca existiram fora
 * desta lousa. Por isso a resposta devolve as linhas removidas: é com elas
 * que o "Desfazer" reconstrói o que foi apagado.
 */
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[id]/windows">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    // Teto baixo de propósito, ao contrário do de criação: uma pessoa limpa
    // a lousa algumas vezes por sessão. Um laço automatizado apagando e
    // restaurando em série é o que este número barra.
    const limit = await rateLimit({
      key: `windows:clear:${user.id}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas limpezas seguidas. Aguarde um pouco.");
    }

    const { id: workspaceId } = await ctx.params;

    const parsed = clearWindowsSchema.safeParse(
      await readOptionalJson(request)
    );
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Dados inválidos."
      );
    }
    const { ids } = parsed.data;

    const workspace = await getOwnedWorkspace(user.id, workspaceId);
    if (!workspace) return errorResponse(404, "Workspace não encontrado.");

    // Lido antes de apagar, e não depois: o `ON DELETE CASCADE` que leva as
    // flechas junto não devolve as linhas que ele mesmo removeu. Sem esta
    // consulta o "Desfazer" traria as janelas de volta desligadas.
    const doomedConnections = await db
      .select({
        fromWindowId: workspaceConnections.fromWindowId,
        toWindowId: workspaceConnections.toWindowId,
      })
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.userId, user.id),
          eq(workspaceConnections.workspaceId, workspaceId),
          ...(ids
            ? [
                or(
                  inArray(workspaceConnections.fromWindowId, ids),
                  inArray(workspaceConnections.toWindowId, ids)
                )!,
              ]
            : [])
        )
      );

    const removed = await db
      .delete(workspaceWindows)
      .where(
        and(
          // Os três termos de sempre — a janela é desta pessoa e está nesta
          // lousa. Trocar o id do workspace na URL não alcança a lousa de
          // ninguém.
          eq(workspaceWindows.userId, user.id),
          eq(workspaceWindows.workspaceId, workspaceId),
          ...(ids ? [inArray(workspaceWindows.id, ids)] : [])
        )
      )
      .returning({
        id: workspaceWindows.id,
        kind: workspaceWindows.kind,
        source: workspaceWindows.source,
        noteId: workspaceWindows.noteId,
        attachmentId: workspaceWindows.attachmentId,
        content: workspaceWindows.content,
        x: workspaceWindows.x,
        y: workspaceWindows.y,
        width: workspaceWindows.width,
        height: workspaceWindows.height,
        zIndex: workspaceWindows.zIndex,
        state: workspaceWindows.state,
      });

    // Só o que desapareceu de verdade vira registro. Fechar uma nota não
    // destrói nada — auditar isso encheria a tabela de eventos que ela não
    // existe para deixar visíveis. Mesmo critério do DELETE de uma janela só.
    const destroyed = removed.filter(
      (row) => row.kind !== "note" && row.kind !== "attachment"
    );
    // Uma flecha também some de vez: ela não existe fora desta lousa.
    if (destroyed.length > 0 || doomedConnections.length > 0) {
      await writeAuditLog({
        action: "DELETE",
        tableName: "workspace_windows",
        recordId: workspaceId,
        userId: user.id,
        oldData: {
          scope: ids ? "selection" : "board",
          removed: removed.length,
          destroyed: destroyed.length,
          connections: doomedConnections.length,
          // Um teto no que vai para o log: uma lousa no limite do plano Pro
          // renderia um jsonb de centenas de KB por limpeza, e o que
          // interessa numa investigação são as primeiras linhas.
          elements: destroyed.slice(0, AUDIT_SAMPLE),
        },
        request,
      });
    }

    return NextResponse.json({
      removed: removed.length,
      // O que o "Desfazer" precisa para reconstruir. Campos listados um a
      // um, como no insert: um campo novo do schema não escapa por aqui sem
      // alguém decidir que ele deve escapar.
      //
      // O `id` vai junto e volta igual. É o que permite as flechas voltarem
      // também: elas apontam para id, e uma janela restaurada com id novo
      // seria, para elas, uma janela que nunca existiu.
      restorable: removed.map((row) => ({
        id: row.id,
        kind: row.kind,
        source: row.source,
        noteId: row.noteId,
        attachmentId: row.attachmentId,
        content: row.content,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
        zIndex: row.zIndex,
        state: row.state,
      })),
      restorableConnections: doomedConnections,
      ...(await readBoard(user.id, workspaceId)),
    });
  } catch (error) {
    logServerError("DELETE /api/workspaces/[id]/windows", error);
    return errorResponse(500, "Erro ao limpar a lousa.");
  }
}

/**
 * Lê o corpo quando existe.
 *
 * "Apagar tudo" é um `DELETE` sem corpo, e `request.json()` lança num corpo
 * vazio. Tratar isso como corpo ausente — e não como erro — é o que deixa as
 * duas formas conviverem na mesma rota.
 */
async function readOptionalJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) ?? {};
  } catch {
    return {};
  }
}

/* ---------------------------------------------------------------------- */

/**
 * Resolve a nota que a janela vai mostrar.
 *
 * Com `noteId`, confere que a nota é desta pessoa — a chave estrangeira
 * composta `(note_id, user_id)` recusaria a linha de qualquer forma, mas um
 * 404 explicado é melhor resposta que um 500 de constraint.
 *
 * Com `title`, cria a nota. Ela nasce dentro do workspace: quem escreve
 * direto na lousa já decidiu onde aquilo mora.
 */
async function resolveNoteId(
  userId: string,
  workspaceId: string,
  input: { noteId?: string; title?: string }
): Promise<string | null> {
  if (input.noteId) {
    const [existing] = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.id, input.noteId), eq(notes.userId, userId)))
      .limit(1);

    return existing?.id ?? null;
  }

  const [created] = await db
    .insert(notes)
    .values({
      userId,
      workspaceId,
      title: input.title!,
      content: "",
      source: "user",
    })
    .returning({ id: notes.id });

  return created.id;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}
