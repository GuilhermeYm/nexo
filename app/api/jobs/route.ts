import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { aiJobs } from "@/lib/db/schema";
import { listAiJobs } from "@/lib/dashboard/queries";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * Painel "Tarefas" — o que os agentes fizeram, estão fazendo, ou pararam de
 * fazer por falta de crédito.
 */
export async function GET() {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    return NextResponse.json({ jobs: await listAiJobs(user.id) });
  } catch (error) {
    const code = await logServerError("GET /api/jobs", error);
    return errorResponse(500, "Erro ao carregar tarefas.", code);
  }
}

/**
 * Limpa o histórico de execuções concluídas da Nexo.
 *
 * O job é só o registro do processamento: apagar esta linha não apaga a
 * nota, as tags, o resumo nem o arquivo que a IA produziu. Estados que ainda
 * pedem acompanhamento ficam fora do filtro, para uma limpeza visual nunca
 * cancelar uma tarefa em curso ou esconder uma decisão pendente.
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
      key: `jobs:clear-succeeded:${user.id}`,
      limit: 12,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas limpezas seguidas. Aguarde um pouco.");
    }

    const removed = await db
      .delete(aiJobs)
      .where(and(eq(aiJobs.userId, user.id), eq(aiJobs.status, "succeeded")))
      .returning({ id: aiJobs.id, kind: aiJobs.kind, label: aiJobs.label });

    if (removed.length > 0) {
      await writeAuditLog({
        request,
        userId: user.id,
        action: "DELETE",
        tableName: "ai_jobs",
        oldData: {
          status: "succeeded",
          count: removed.length,
          jobs: removed.map((job) => ({
            id: job.id,
            kind: job.kind,
            label: job.label,
          })),
        },
      });
    }

    return NextResponse.json({
      deletedIds: removed.map((job) => job.id),
    });
  } catch (error) {
    const code = await logServerError("DELETE /api/jobs", error, { userId }, request);
    return errorResponse(500, "Não foi possível limpar as tarefas concluídas.", code);
  }
}
