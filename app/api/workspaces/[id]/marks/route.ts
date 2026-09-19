import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceBoardMarks } from "@/lib/db/schema";
import { ABSOLUTE_BOARD_MARKS_PER_BOARD } from "@/lib/limits";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getOwnedWorkspace, listBoardMarks } from "@/lib/workspace/queries";
import { createBoardMarkSchema, deleteBoardMarksSchema } from "@/lib/validations/workspace";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  let userId: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;
    const { id: workspaceId } = await ctx.params;
    if (!(await getOwnedWorkspace(user.id, workspaceId))) return errorResponse(404, "Workspace não encontrado.");
    return NextResponse.json({ marks: await listBoardMarks(user.id, workspaceId) });
  } catch (error) {
    const code = await logServerError("GET /api/workspaces/[id]/marks", error, { userId }, request);
    return errorResponse(500, "Erro ao carregar os desenhos.", code);
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  let userId: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({ key: `marks:create:${user.id}`, limit: 900, windowMs: 60 * 60 * 1000 });
    if (!limit.success) return errorResponse(429, "Muitos desenhos seguidos. Aguarde um pouco.");

    const { id: workspaceId } = await ctx.params;
    const parsed = createBoardMarkSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse(400, parsed.error.issues[0]?.message ?? "Desenho inválido.");
    if (!(await getOwnedWorkspace(user.id, workspaceId))) return errorResponse(404, "Workspace não encontrado.");

    const [count] = await db.select({ total: sql<number>`count(*)::int` })
      .from(workspaceBoardMarks)
      .where(and(eq(workspaceBoardMarks.userId, user.id), eq(workspaceBoardMarks.workspaceId, workspaceId)));
    if ((count?.total ?? 0) >= ABSOLUTE_BOARD_MARKS_PER_BOARD) {
      return errorResponse(409, `Esta lousa chegou ao limite de ${ABSOLUTE_BOARD_MARKS_PER_BOARD} desenhos.`);
    }

    const [created] = await db.insert(workspaceBoardMarks).values({
      userId: user.id,
      workspaceId,
      kind: parsed.data.kind,
      points: parsed.data.points,
      x: parsed.data.x,
      y: parsed.data.y,
      width: parsed.data.width,
      height: parsed.data.height,
      tone: parsed.data.tone,
      weight: parsed.data.weight,
    }).returning({
      id: workspaceBoardMarks.id,
      kind: workspaceBoardMarks.kind,
      points: workspaceBoardMarks.points,
      x: workspaceBoardMarks.x,
      y: workspaceBoardMarks.y,
      width: workspaceBoardMarks.width,
      height: workspaceBoardMarks.height,
      tone: workspaceBoardMarks.tone,
      weight: workspaceBoardMarks.weight,
    });

    return NextResponse.json({ mark: created }, { status: 201 });
  } catch (error) {
    const code = await logServerError("POST /api/workspaces/[id]/marks", error, { userId }, request);
    return errorResponse(500, "Erro ao guardar o desenho.", code);
  }
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  let userId: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;
    const limit = await rateLimit({ key: `marks:delete:${user.id}`, limit: 900, windowMs: 60 * 60 * 1000 });
    if (!limit.success) return errorResponse(429, "Muitas remoções seguidas. Aguarde um pouco.");

    const { id: workspaceId } = await ctx.params;
    const parsed = deleteBoardMarksSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse(400, parsed.error.issues[0]?.message ?? "Dados inválidos.");
    if (!(await getOwnedWorkspace(user.id, workspaceId))) return errorResponse(404, "Workspace não encontrado.");

    const removed = await db.delete(workspaceBoardMarks).where(and(
      eq(workspaceBoardMarks.userId, user.id),
      eq(workspaceBoardMarks.workspaceId, workspaceId),
      inArray(workspaceBoardMarks.id, parsed.data.ids)
    )).returning({
      id: workspaceBoardMarks.id,
      kind: workspaceBoardMarks.kind,
      points: workspaceBoardMarks.points,
      x: workspaceBoardMarks.x,
      y: workspaceBoardMarks.y,
      width: workspaceBoardMarks.width,
      height: workspaceBoardMarks.height,
      tone: workspaceBoardMarks.tone,
      weight: workspaceBoardMarks.weight,
    });
    return NextResponse.json({ removed: removed.length, restorableMarks: removed });
  } catch (error) {
    const code = await logServerError("DELETE /api/workspaces/[id]/marks", error, { userId }, request);
    return errorResponse(500, "Erro ao apagar o desenho.", code);
  }
}
