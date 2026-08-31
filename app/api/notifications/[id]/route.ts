import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { markNotificationRead } from "@/lib/inbox/queries";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const patchNotificationSchema = z.object({
  read: z.boolean(),
});

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Marca uma notificação como lida ou não lida.
 *
 * Só o dono pode alterar; o filtro por `user_id` na query é redundante com a
 * RLS, mas fica assim a rota não depende da política estar certa.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/notifications/[id]">
) {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const limit = await rateLimit({
      key: `notifications:read:${user.id}`,
      limit: 600,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas ações seguidas. Aguarde um pouco.");
    }

    const { id } = await ctx.params;
    // Um texto qualquer no lugar do uuid faz o Postgres lançar `invalid input
    // syntax`, que sairia daqui como 500 — erro de servidor para o que é um
    // endereço inexistente.
    if (!UUID.test(id)) return errorResponse(404, "Notificação não encontrada.");

    const parsed = patchNotificationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(400, "O campo 'read' deve ser um booleano.");
    }

    const ok = await markNotificationRead(user.id, id, parsed.data.read);
    if (!ok) return errorResponse(404, "Notificação não encontrada.");

    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = await logServerError("PATCH /api/notifications/[id]", error);
    return errorResponse(500, "Erro ao atualizar a notificação.", code);
  }
}
