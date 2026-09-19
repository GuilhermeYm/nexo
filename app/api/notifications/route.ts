import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { NOTIFICATIONS_BATCH_MAX } from "@/lib/inbox/limits";
import {
  countUnreadNotifications,
  deleteNotifications,
  listNotifications,
  markNotificationsRead,
} from "@/lib/inbox/queries";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const idsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(NOTIFICATIONS_BATCH_MAX)
  // Repetido não é erro de quem chama; a consulta só precisa de cada um uma vez.
  .transform((ids) => [...new Set(ids)]);

const patchSchema = z.object({ ids: idsSchema, read: z.boolean() });
const deleteSchema = z.object({ ids: idsSchema });

/**
 * Lista as notificações da Entrada e a contagem de não lidas.
 *
 * O cliente chama isto para revalidar a lista e o número do trilho quando
 * algo mudar; a página inicial já vem do Server Component.
 */
export async function GET() {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const [notifications, unreadCount] = await Promise.all([
      listNotifications(user.id),
      countUnreadNotifications(user.id),
    ]);

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    const code = await logServerError("GET /api/notifications", error);
    return errorResponse(500, "Erro ao carregar as notificações.", code);
  }
}

/**
 * Marca as selecionadas como lidas ou não lidas.
 *
 * Mesmo teto de chamadas do "marcar todas": cada uma escreve em até
 * `NOTIFICATIONS_BATCH_MAX` linhas.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const limit = await rateLimit({
      key: `notifications:batch-read:${user.id}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas ações seguidas. Aguarde um pouco.");
    }

    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(400, "Seleção inválida.");
    }

    const count = await markNotificationsRead(
      user.id,
      parsed.data.ids,
      parsed.data.read
    );
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    const code = await logServerError("PATCH /api/notifications", error);
    return errorResponse(500, "Erro ao atualizar as notificações.", code);
  }
}

/**
 * Apaga as selecionadas.
 *
 * Até 0031 notificação não se apagava — o aviso de sistema era só lido. Com
 * cada tarefa escrevendo aqui, a Entrada precisa de faxina. O PostgREST
 * continua sem `DELETE` (a trava de 0011 fica): só esta rota apaga, e só do
 * `user_id` do token.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  let userId: string | undefined;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `notifications:delete:${user.id}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas exclusões seguidas. Aguarde um pouco.");
    }

    const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(400, "Seleção inválida.");
    }

    const count = await deleteNotifications(user.id, parsed.data.ids);

    if (count > 0) {
      await writeAuditLog({
        request,
        userId: user.id,
        action: "DELETE",
        tableName: "notifications",
        oldData: { count, ids: parsed.data.ids },
      });
    }

    return NextResponse.json({ ok: true, count });
  } catch (error) {
    const code = await logServerError(
      "DELETE /api/notifications",
      error,
      { userId },
      request
    );
    return errorResponse(500, "Erro ao apagar as notificações.", code);
  }
}
