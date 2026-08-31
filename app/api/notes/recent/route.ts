import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { listRecentNotes } from "@/lib/dashboard/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Painel "Recentes". O cliente chama isto quando o Realtime avisa que uma
 * nota mudou — não em intervalo fixo.
 */
export async function GET() {
  const supabase = await createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");

    return NextResponse.json({ notes: await listRecentNotes(user.id) });
  } catch (error) {
    const code = await logServerError("GET /api/notes/recent", error);
    return errorResponse(500, "Erro ao carregar notas recentes.", code);
  }
}
