import { NextResponse } from "next/server";

import { errorResponse, logServerError } from "@/lib/api";
import { listAiJobs } from "@/lib/dashboard/queries";
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
    logServerError("GET /api/jobs", error);
    return errorResponse(500, "Erro ao carregar tarefas.");
  }
}
