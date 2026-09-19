import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { countUnreadNotifications } from "@/lib/inbox/queries";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * Só o número de não lidas — o que o trilho do dashboard mostra sobre o ícone
 * da Entrada. Rebuscado a cada evento do Realtime em `notifications`; a lista
 * inteira seria duzentas linhas para desenhar um número.
 */
export async function GET() {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    const limit = await rateLimit({
      key: `notifications:unread:${user.id}`,
      limit: 240,
      windowMs: 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas requisições seguidas. Aguarde um pouco.");
    }

    const unreadCount = await countUnreadNotifications(user.id);
    return NextResponse.json({ unreadCount });
  } catch (error) {
    const code = await logServerError("GET /api/notifications/unread", error);
    return errorResponse(500, "Erro ao contar as notificações.", code);
  }
}
