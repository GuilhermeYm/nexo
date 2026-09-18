import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { listWorkspaces } from "@/lib/dashboard/queries";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(280).optional(),
  // Identificador do ícone no nosso conjunto — nunca markup.
  icon: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,32}$/)
    .optional(),
  // Um dos matizes de tag do tema, por posição. Cor livre do cliente não
  // entra: ela acabaria fora da paleta e fora do contraste.
  color: z.enum(["1", "2", "3", "4", "5", "6"]).optional(),
});

export async function GET() {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    return NextResponse.json({ workspaces: await listWorkspaces(user.id) });
  } catch (error) {
    const code = await logServerError("GET /api/workspaces", error);
    return errorResponse(500, "Erro ao carregar workspaces.", code);
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
      key: `workspaces:create:${user.id}`,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitos workspaces criados. Aguarde um pouco.");
    }

    const parsed = createWorkspaceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(400, "Nome de workspace inválido.");
    }

    const [created] = await db
      .insert(workspaces)
      .values({
        // O user_id vem do token, nunca do corpo da requisição.
        userId: user.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        icon: parsed.data.icon ?? null,
        color: parsed.data.color ?? null,
      })
      .returning({
        id: workspaces.id,
        name: workspaces.name,
        icon: workspaces.icon,
        color: workspaces.color,
        isDefault: workspaces.isDefault,
      });

    await writeAuditLog({
      action: "CREATE",
      tableName: "workspaces",
      recordId: created.id,
      userId: user.id,
      newData: created,
      request,
    });

    return NextResponse.json(
      { workspace: { ...created, noteCount: 0 } },
      { status: 201 }
    );
  } catch (error) {
    const code = await logServerError("POST /api/workspaces", error, { userId }, request);
    return errorResponse(500, "Erro ao criar workspace.", code);
  }
}
