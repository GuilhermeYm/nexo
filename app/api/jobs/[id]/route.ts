import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { getJobDetail } from "@/lib/dashboard/job-history";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { aiJobs, errorReports } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const jobIdSchema = z.string().uuid();

/**
 * O detalhe de uma tarefa, para a tela cheia de Tarefas.
 *
 * Só metadados do que a IA fez — tags, tipo, provedor, tempos, código de
 * erro — e, na leitura de nota, o resumo atual lido de `note_ai_state`. O
 * texto da nota nunca sai por aqui. Tarefa de outra conta responde 404, igual
 * a uma inexistente.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/jobs/[id]">
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
    const parsedId = jobIdSchema.safeParse(id);
    if (!parsedId.success) return errorResponse(400, "Tarefa inválida.");

    const limit = await rateLimit({
      key: `jobs:detail:${user.id}`,
      limit: 240,
      windowMs: 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas consultas seguidas. Aguarde um instante.");
    }

    const job = await getJobDetail(user.id, parsedId.data);
    if (!job) return errorResponse(404, "Tarefa não encontrada.");

    return NextResponse.json({ job });
  } catch (error) {
    const code = await logServerError("GET /api/jobs/[id]", error, { userId }, request);
    return errorResponse(500, "Erro ao carregar a tarefa.", code);
  }
}

/**
 * Remove do histórico uma tarefa que terminou em falha.
 *
 * Estados retomáveis (`insufficient_credits`) e tarefas em andamento nunca
 * entram neste caminho. A nota e o arquivo também ficam: eles são conteúdo
 * útil da conta, não resíduos do job, e o próprio feed informa que continuam
 * guardados quando a classificação falha.
 *
 * O relatório técnico ligado pelo `error_code` é removido somente quando
 * nenhum outro job do usuário aponta para ele. O dedupe de erros pode fazer
 * várias falhas compartilharem o mesmo código, então apagá-lo sem essa
 * conferência quebraria o suporte das tarefas restantes.
 */
export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/jobs/[id]">
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
      key: `jobs:delete:${user.id}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas exclusões seguidas. Aguarde um pouco.");
    }

    const { id: rawId } = await ctx.params;
    const parsedId = jobIdSchema.safeParse(rawId);
    if (!parsedId.success) return errorResponse(404, "Tarefa não encontrada.");
    const jobId = parsedId.data;

    const removed = await db.transaction(async (tx) => {
      const [job] = await tx
        .delete(aiJobs)
        .where(
          and(
            eq(aiJobs.id, jobId),
            eq(aiJobs.userId, user.id),
            eq(aiJobs.status, "failed")
          )
        )
        .returning({
          id: aiJobs.id,
          kind: aiJobs.kind,
          label: aiJobs.label,
          errorCode: aiJobs.errorCode,
        });

      if (!job) return null;

      if (job.errorCode) {
        const [otherReference] = await tx
          .select({ id: aiJobs.id })
          .from(aiJobs)
          .where(
            and(
              eq(aiJobs.userId, user.id),
              eq(aiJobs.errorCode, job.errorCode),
              ne(aiJobs.id, job.id)
            )
          )
          .limit(1);

        if (!otherReference) {
          await tx
            .delete(errorReports)
            .where(
              and(
                eq(errorReports.code, job.errorCode),
                eq(errorReports.userId, user.id)
              )
            );
        }
      }

      return job;
    });

    if (!removed) {
      return errorResponse(
        404,
        "Esta tarefa não existe ou não pode ser excluída."
      );
    }

    await writeAuditLog({
      request,
      userId: user.id,
      action: "DELETE",
      tableName: "ai_jobs",
      recordId: removed.id,
      oldData: { kind: removed.kind, label: removed.label, status: "failed" },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = await logServerError(
      "DELETE /api/jobs/[id]",
      error,
      { userId },
      request
    );
    return errorResponse(500, "Não foi possível excluir esta falha.", code);
  }
}
