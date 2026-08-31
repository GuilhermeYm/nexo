import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import {
  countUnreadNotifications,
  listNotifications,
} from "@/lib/inbox/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Lista as notificações da Entrada e a contagem de não lidas.
 *
 * O cliente chama isto para revalidar a lista quando algo mudar; a página
 * inicial já vem do Server Component.
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
