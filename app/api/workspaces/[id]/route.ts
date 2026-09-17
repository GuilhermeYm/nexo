import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { notes, workspaces } from "@/lib/db/schema";
import { invalidateNoteListCache } from "@/lib/notes/cache";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import {
  BOARD_PATTERNS,
  BOARD_TONES,
} from "@/lib/workspace/board-background";
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
    const code = await logServerError("GET /api/workspaces/[id]", error);
    return errorResponse(500, "Erro ao carregar o workspace.", code);
  }
}

/**
 * O que o cliente pode mudar num workspace: o nome e o fundo da lousa.
 *
 * Os três campos são opcionais e pelo menos um precisa vir — um PATCH vazio
 * é pedido malformado, não uma escrita sem efeito. `boardTone` aceita `null`
 * de propósito: é assim que se volta à superfície neutra, e sem isso a única
 * saída seria não existir um jeito de desfazer a escolha de cor.
 */
const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    boardPattern: z.enum(BOARD_PATTERNS).optional(),
    boardTone: z.enum(BOARD_TONES).nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.boardPattern !== undefined ||
      value.boardTone !== undefined,
    { message: "Nada para alterar." }
  );

/**
 * Renomear um workspace, ou mudar o fundo da lousa.
 *
 * Só esses campos. Trocar o dono, o plano ou a marca de padrão por aqui seria
 * aceitar do cliente coisas que ele não tem por que decidir — o campo entra
 * um a um, nunca o corpo inteiro.
 *
 * A troca de nome **é auditada**; a do fundo, não. O nome é como a pessoa
 * reencontra o que guardou, e um renomeio que ninguém lembra de ter feito é
 * indistinguível de um sumiço. O fundo é aparência, e trocá-lo não esconde
 * nada de ninguém — mesmo critério da cor da tag e da cor da flecha.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[id]">
) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    // O teto cobre as duas coisas que esta rota faz, e é o gesto mais
    // frequente que manda nele: mudar o fundo é clicar numa amostra e ver o
    // resultado na hora, como a cor da tag — várias vezes seguidas até achar
    // a que serve. Renomear, ninguém faz sessenta vezes por hora.
    const limit = await rateLimit({
      key: `workspaces:update:${user.id}`,
      limit: 240,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas alterações seguidas. Aguarde um pouco.");
    }

    const { id } = await ctx.params;
    const parsed = updateWorkspaceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(400, "Dados inválidos para este workspace.");
    }
    const input = parsed.data;

    // O `id` vem da URL e por isso é entrada do cliente como qualquer outra.
    const current = await getOwnedWorkspace(user.id, id);
    if (!current) return errorResponse(404, "Workspace não encontrado.");

    const renamed = input.name !== undefined && input.name !== current.name;
    const repainted =
      (input.boardPattern !== undefined &&
        input.boardPattern !== current.background.pattern) ||
      (input.boardTone !== undefined &&
        input.boardTone !== current.background.tone);

    if (!renamed && !repainted) {
      return NextResponse.json({ workspace: current });
    }

    const [updated] = await db
      .update(workspaces)
      // Campo a campo: o corpo validado nunca entra inteiro num `set()`.
      .set({
        ...(renamed && { name: input.name }),
        ...(input.boardPattern !== undefined && {
          boardPattern: input.boardPattern,
        }),
        ...(input.boardTone !== undefined && { boardTone: input.boardTone }),
        updatedAt: new Date(),
      })
      // O filtro por `user_id` é redundante com a RLS e fica assim de
      // propósito: a rota não depende de a política estar certa para não
      // escrever na linha de outra pessoa.
      .where(and(eq(workspaces.id, id), eq(workspaces.userId, user.id)))
      .returning({
        id: workspaces.id,
        name: workspaces.name,
        boardPattern: workspaces.boardPattern,
        boardTone: workspaces.boardTone,
      });

    if (!updated) return errorResponse(404, "Workspace não encontrado.");

    // Só o nome. Uma amostra de cor por clique encheria a trilha dos eventos
    // que ela existe para deixar visíveis.
    if (renamed) {
      await writeAuditLog({
        action: "UPDATE",
        tableName: "workspaces",
        recordId: id,
        userId: user.id,
        oldData: { name: current.name },
        newData: { name: updated.name },
        request,
      });

      // O nome do workspace viaja junto da lista de notas; o fundo da lousa,
      // não. Invalidar o cache por uma troca de cor seria jogar fora uma
      // leitura boa por uma mudança que ela nem carrega.
      await invalidateNoteListCache(user.id);
    }

    return NextResponse.json({ workspace: updated });
  } catch (error) {
    const code = await logServerError("PATCH /api/workspaces/[id]", error, { userId }, request);
    return errorResponse(500, "Erro ao salvar o workspace.", code);
  }
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[id]">
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

    await invalidateNoteListCache(user.id);

    return NextResponse.json({ ok: true, unlinkedNotes: context?.noteCount ?? 0 });
  } catch (error) {
    const code = await logServerError("DELETE /api/workspaces/[id]", error, { userId }, request);
    return errorResponse(500, "Erro ao excluir o workspace.", code);
  }
}
