import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { agendaTitle } from "@/lib/agenda/day";
import { getAgendaDay } from "@/lib/agenda/queries";
import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { countTaskItems, richTextToPlain } from "@/lib/editor/document";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getHomeWorkspaceId } from "@/lib/usage/queries";
import { agendaDateSchema, putAgendaSchema } from "@/lib/validations/agenda";

/**
 * A lista de tarefas de um dia.
 *
 * `GET` lê; `PUT` faz get-or-create. **É a única rota nova que escreve na
 * Agenda** — marcar uma caixa é editar o documento, e isso continua sendo
 * `PATCH /api/notes/[id]`, que já deriva o texto puro, já tem rate limit e já
 * audita o que precisa ser auditado.
 *
 * `PUT` e não `POST`, com a data no caminho e não no corpo: get-or-create de
 * um dia é idempotente por definição, e `POST` sugeriria "crie mais uma"
 * quando o produto inteiro diz que só existe uma. O caminho ainda torna o dia
 * endereçável e legível num log.
 */

type Ctx = { params: Promise<{ date: string }> };

/** A lista do dia, ou `{ note: null }`. **Sem efeito colateral: ler não cria.** */
export async function GET(request: Request, ctx: Ctx) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const { date } = await ctx.params;
    const parsed = agendaDateSchema.safeParse(date);
    if (!parsed.success) return errorResponse(400, "Data inválida.");

    const note = await getAgendaDay(user.id, parsed.data);
    return NextResponse.json({ note });
  } catch (error) {
    const code = await logServerError("GET /api/agenda/[date]", error, { userId }, request);
    return errorResponse(500, "Não foi possível ler o dia.", code);
  }
}

/**
 * Abre — criando, se preciso — a lista daquele dia.
 *
 * A ordem aqui é deliberada, e o `SELECT` vir **antes** da checagem de cota é
 * correção, não otimização: o segundo e o centésimo `PUT` do mesmo dia não
 * capturam nada, então não podem consultar cota nem consumir nada.
 * `getNoteCaptureContext` — a consulta cara, com quatro subconsultas
 * escalares — só roda no único `PUT` que de fato insere.
 *
 * A criação é preguiçosa por decisão de produto: a nota do dia só nasce
 * quando há conteúdo de verdade. Abrir a Agenda de manhã e não escrever nada
 * não pode gastar uma das 50 capturas mensais do Gratuito — isso não seria
 * bater no teto, seria o teto mentindo.
 */
export async function PUT(request: Request, ctx: Ctx) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `agenda:put:${user.id}`,
      limit: 120,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas escritas seguidas. Aguarde um pouco.");
    }

    const { date: rawDate } = await ctx.params;
    const parsedDate = agendaDateSchema.safeParse(rawDate);
    if (!parsedDate.success) return errorResponse(400, "Data inválida.");
    const date = parsedDate.data;

    const parsedBody = putAgendaSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsedBody.success) return errorResponse(400, "Documento inválido.");
    const { contentRich } = parsedBody.data;

    // 1) Já existe? Devolve e sai — sem tocar em cota.
    const existing = await getAgendaDay(user.id, date);
    if (existing) {
      return NextResponse.json({ note: existing, created: false });
    }

    // 2) Vai criar. Um documento vazio não é conteúdo: o andaime da sala é uma
    //    caixa em branco, e ele não pode virar nota. Mesma regra e mesma
    //    função de `POST /api/notes` — "não é nota; é um clique errado".
    const content = contentRich !== undefined ? richTextToPlain(contentRich) : "";
    if (content.trim().length === 0) {
      return errorResponse(400, "Escreva uma tarefa antes.");
    }

    const homeWorkspaceId = await getHomeWorkspaceId(user.id);

    const tally = countTaskItems(contentRich);

    const [created] = await db
      .insert(notes)
      .values({
        // Do token, nunca do corpo.
        userId: user.id,
        workspaceId: homeWorkspaceId,
        title: agendaTitle(date),
        content,
        contentRich: contentRich ?? null,
        type: "task",
        source: "user",
        taskDate: date,
        tasksTotal: tally.total,
        tasksDone: tally.done,
      })
      // O índice `notes_user_task_date_key` é PARCIAL, e o `where` abaixo tem
      // de repetir o predicado dele **inteiro**. Sem isso o Postgres não acha
      // índice único que case com o alvo do conflito e levanta 42P10 em toda
      // requisição — não só nas concorrentes.
      .onConflictDoNothing({
        target: [notes.userId, notes.taskDate],
        where: sql`${notes.type} = 'task' and ${notes.taskDate} is not null and ${notes.status} <> 'deleted'`,
      })
      .returning({ id: notes.id });

    if (created) {
      const note = await getAgendaDay(user.id, date);
      return NextResponse.json({ note, created: true }, { status: 201 });
    }

    // Alguém chegou primeiro: outra aba, outro aparelho, ou o segundo
    // `onUpdate` do mesmo editor antes de a primeira resposta voltar. Reler é
    // a resposta certa — a lista daquele dia existe, e é essa. Sem laço de
    // retry: se o re-SELECT vier vazio, alguém apagou entre o INSERT e ele, e
    // isso é 409, não motivo para tentar de novo.
    const raced = await getAgendaDay(user.id, date);
    if (!raced) return errorResponse(409, "A lista deste dia mudou. Recarregue.");
    return NextResponse.json({ note: raced, created: false });
  } catch (error) {
    const code = await logServerError("PUT /api/agenda/[date]", error, { userId }, request);
    return errorResponse(500, "Não foi possível abrir o dia.", code);
  }
}
