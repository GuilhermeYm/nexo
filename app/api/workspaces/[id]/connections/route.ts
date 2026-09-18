import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceConnections, workspaceWindows } from "@/lib/db/schema";
import { ABSOLUTE_CONNECTIONS_PER_BOARD } from "@/lib/limits";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import {
  connectionContentColumns,
  getOwnedWorkspace,
  listBoardConnections,
} from "@/lib/workspace/queries";
import { createConnectionSchema } from "@/lib/validations/workspace";

/**
 * As ligações de uma lousa.
 *
 * Não há `GET` aqui: as flechas viajam junto com as janelas, no retrato que
 * `/windows` devolve. Separá-las seria pedir ao cliente que juntasse dois
 * retratos tirados em momentos diferentes — e o intervalo entre eles é
 * exatamente onde mora a flecha apontando para uma janela que já foi
 * fechada.
 *
 * O `PATCH` também não mora aqui: origem e destino não se editam — mudar a
 * direção é apagar e ligar de novo. O que se edita é o **rótulo**, e ele tem
 * rota própria (`/connections/[connectionId]`), com a policy de UPDATE que
 * 0012 abriu restrita a essa única coluna.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[id]/connections">
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
      key: `connections:create:${user.id}`,
      limit: 480,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas ligações seguidas. Aguarde um pouco.");
    }

    const { id: workspaceId } = await ctx.params;

    const parsed = createConnectionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        400,
        parsed.error.issues[0]?.message ?? "Dados inválidos."
      );
    }
    const { fromWindowId, toWindowId } = parsed.data;

    const workspace = await getOwnedWorkspace(user.id, workspaceId);
    if (!workspace) return errorResponse(404, "Workspace não encontrado.");

    // As duas pontas e o teto, em paralelo — uma não depende da outra. A
    // chave estrangeira de três colunas recusaria uma janela de outra pessoa
    // ou de outra lousa de qualquer forma; isto existe para a resposta ser um
    // 404 explicado em vez de um 500 de constraint.
    const [[ends], [total]] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workspaceWindows)
        .where(
          and(
            eq(workspaceWindows.userId, user.id),
            eq(workspaceWindows.workspaceId, workspaceId),
            inArray(workspaceWindows.id, [fromWindowId, toWindowId])
          )
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(workspaceConnections)
        .where(
          and(
            eq(workspaceConnections.userId, user.id),
            eq(workspaceConnections.workspaceId, workspaceId)
          )
        ),
    ]);

    if ((ends?.count ?? 0) < 2) {
      return errorResponse(404, "Um dos elementos não está nesta lousa.");
    }

    if ((total?.count ?? 0) >= ABSOLUTE_CONNECTIONS_PER_BOARD) {
      return errorResponse(
        409,
        `Esta lousa chegou ao limite de ${ABSOLUTE_CONNECTIONS_PER_BOARD} ligações.`
      );
    }

    const [created] = await db
      .insert(workspaceConnections)
      .values({
        // Do token, nunca do corpo.
        userId: user.id,
        workspaceId,
        fromWindowId,
        toWindowId,
      })
      .returning({ id: workspaceConnections.id });

    return NextResponse.json(
      {
        connectionId: created.id,
        connections: await listBoardConnections(user.id, workspaceId),
      },
      { status: 201 }
    );
  } catch (error) {
    // Índice único (from_window_id, to_window_id): já existe esta flecha.
    if (isUniqueViolation(error)) {
      return errorResponse(409, "Essas duas coisas já estão ligadas.");
    }

    const code = await logServerError("POST /api/workspaces/[id]/connections", error, { userId }, request);
    return errorResponse(500, "Erro ao ligar os elementos.", code);
  }
}

/**
 * Apaga ligações em lote — é a borracha passando por cima das flechas.
 *
 * Sem corpo, todas as ligações da lousa. Com `{ ids }`, as que a passada
 * encostou.
 *
 * Uma ligação apagada **não** gera audit log. Ela não carrega conteúdo: é
 * uma relação entre duas coisas que continuam onde estavam, e refazê-la é um
 * gesto. Um registro por flecha afogaria os eventos que a tabela existe para
 * deixar visíveis — o mesmo critério que já vale para o salvamento de texto
 * e para o fechamento de uma janela de nota. A limpeza em lote da lousa, essa
 * sim, registra quantas flechas caíram junto.
 */
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/workspaces/[id]/connections">
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
      key: `connections:delete:${user.id}`,
      limit: 480,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas remoções seguidas. Aguarde um pouco.");
    }

    const { id: workspaceId } = await ctx.params;
    const ids = await readIds(request);

    const workspace = await getOwnedWorkspace(user.id, workspaceId);
    if (!workspace) return errorResponse(404, "Workspace não encontrado.");

    // Uma lista que chegou vazia é "nada a apagar", nunca "apagar tudo". A
    // ausência da lista é que significa a lousa inteira, e a diferença entre
    // as duas é a diferença entre um clique perdido e a lousa limpa.
    if (ids !== null && ids.length === 0) {
      return NextResponse.json({
        removed: 0,
        restorableConnections: [],
        connections: await listBoardConnections(user.id, workspaceId),
      });
    }

    const removed = await db
      .delete(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.userId, user.id),
          eq(workspaceConnections.workspaceId, workspaceId),
          ...(ids ? [inArray(workspaceConnections.id, ids)] : [])
        )
      )
      .returning({
        fromWindowId: workspaceConnections.fromWindowId,
        toWindowId: workspaceConnections.toWindowId,
        // O rótulo e a aparência voltam junto no "Desfazer": são escolhas da
        // pessoa, e restaurar a flecha muda e cinza seria desfazer só metade.
        ...connectionContentColumns,
      });

    return NextResponse.json({
      removed: removed.length,
      // O que o "Desfazer" precisa: a flecha é os dois ids, e as janelas
      // continuam onde estavam.
      restorableConnections: removed,
      connections: await listBoardConnections(user.id, workspaceId),
    });
  } catch (error) {
    const code = await logServerError("DELETE /api/workspaces/[id]/connections", error, { userId }, request);
    return errorResponse(500, "Erro ao remover as ligações.", code);
  }
}

/* ---------------------------------------------------------------------- */

/**
 * Os ids do corpo, quando ele existe.
 *
 * "Apagar todas" é um `DELETE` sem corpo, e `request.json()` lança num corpo
 * vazio — tratar isso como corpo ausente é o que deixa as duas formas
 * conviverem na mesma rota. Ids que não são uuid saem da lista em vez de
 * derrubar a requisição: a cláusula `IN` já não casaria com nada.
 */
async function readIds(request: Request): Promise<string[] | null> {
  try {
    const body = (await request.json()) as { ids?: unknown };
    if (!Array.isArray(body?.ids)) return null;

    return body.ids
      .filter((id): id is string => typeof id === "string" && UUID.test(id))
      .slice(0, ABSOLUTE_CONNECTIONS_PER_BOARD);
  } catch {
    return null;
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}
