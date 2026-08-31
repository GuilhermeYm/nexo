import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { markAllNotificationsRead } from "@/lib/inbox/queries";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * Marca todas as notificações não lidas do usuário como lidas.
 *
 * O teto é mais baixo que o da rota de uma notificação só: aqui cada chamada
 * escreve em **todas** as linhas não lidas, e é um botão que ninguém aperta
 * sessenta vezes por hora sem estar tentando outra coisa.
 */
export async function PATCH() {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const limit = await rateLimit({
      key: `notifications:read-all:${user.id}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas ações seguidas. Aguarde um pouco.");
    }

    const count = await markAllNotificationsRead(user.id);
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    const code = await logServerError("PATCH /api/notifications/read-all", error);
    return errorResponse(500, "Erro ao marcar notificações como lidas.", code);
  }
}
