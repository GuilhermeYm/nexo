import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceBoardMarks } from "@/lib/db/schema";
import { ABSOLUTE_BOARD_MARKS_PER_BOARD } from "@/lib/limits";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getOwnedWorkspace, listBoardMarks } from "@/lib/workspace/queries";
import { createBoardMarkSchema } from "@/lib/validations/workspace";

const restoreSchema = z.object({
  marks: z.array(z.object({ id: z.uuid() }).passthrough()).max(ABSOLUTE_BOARD_MARKS_PER_BOARD),
}).strict();

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  let userId: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;
    const limit = await rateLimit({ key: `marks:restore:${user.id}`, limit: 480, windowMs: 60 * 60 * 1000 });
    if (!limit.success) return errorResponse(429, "Muitas restaurações seguidas. Aguarde um pouco.");
    const { id: workspaceId } = await ctx.params;
    if (!(await getOwnedWorkspace(user.id, workspaceId))) return errorResponse(404, "Workspace não encontrado.");

    const raw = await request.json().catch(() => null);
    const envelope = restoreSchema.safeParse(raw);
    if (!envelope.success) return errorResponse(400, "Desenhos inválidos.");
    const marks = envelope.data.marks.map(({ id, ...mark }) => {
      const parsed = createBoardMarkSchema.safeParse(mark);
      return parsed.success ? { id, ...parsed.data } : null;
    });
    if (marks.some((mark) => mark === null)) return errorResponse(400, "Desenhos inválidos.");

    await db.insert(workspaceBoardMarks).values(marks.map((mark) => ({
      ...mark!, userId: user.id, workspaceId,
    }))).onConflictDoNothing();
    return NextResponse.json({ marks: await listBoardMarks(user.id, workspaceId) });
  } catch (error) {
    const code = await logServerError("POST /api/workspaces/[id]/marks/restore", error, { userId }, request);
    return errorResponse(500, "Erro ao restaurar os desenhos.", code);
  }
}
