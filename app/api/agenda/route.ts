import { NextResponse } from "next/server";

import { agendaRangeSchema } from "@/lib/validations/agenda";
import { errorResponse, logServerError } from "@/lib/api";
import { listAgendaDays } from "@/lib/agenda/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * A faixa de dias da Agenda.
 *
 * É a rota que o `useLiveResource` da sala rebusca quando o Realtime avisa
 * que `notes` mudou — por isso ela devolve o retrato inteiro da faixa, e não
 * um patch. Mesmo princípio dos painéis do dashboard.
 *
 * **Não devolve `content_rich`.** É exatamente para isso que `tasks_total` e
 * `tasks_done` existem: trinta dias com "5 de 7" custam uma consulta e nenhum
 * documento. Quem precisa do documento pede o dia em
 * `GET /api/agenda/[date]`.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const url = new URL(request.url);
    const parsed = agendaRangeSchema.safeParse({
      from: url.searchParams.get("from") ?? "",
      to: url.searchParams.get("to") ?? "",
    });
    if (!parsed.success) return errorResponse(400, "Intervalo inválido.");

    const days = await listAgendaDays(user.id, parsed.data.from, parsed.data.to);
    return NextResponse.json({ days });
  } catch (error) {
    const code = await logServerError("GET /api/agenda", error, { userId }, request);
    return errorResponse(500, "Não foi possível ler a agenda.", code);
  }
}
