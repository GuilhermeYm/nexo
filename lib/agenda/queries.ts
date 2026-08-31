import "server-only";

import { and, between, desc, eq, isNotNull, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { notes } from "@/lib/db/schema";

/**
 * As consultas da Agenda, compartilhadas entre a página e as rotas.
 *
 * **O discriminador é `task_date`, nunca `type` sozinho.** A IA já classifica
 * upload como `type = 'task'` (`lib/ai/classify-document.ts`), e essas notas
 * não têm data: elas são capturas de verdade, aparecem em Recentes e não
 * pertencem à Agenda. Só a lista de um dia tem `task_date`.
 */

/** Uma linha da faixa de dias. Sem `contentRich` — ver `listAgendaDays`. */
export interface AgendaDay {
  id: string;
  /** `YYYY-MM-DD`. Vem do Postgres como texto, porque a coluna é `date`. */
  date: string;
  title: string;
  tasksTotal: number;
  tasksDone: number;
  updatedAt: Date;
}

/** A lista de um dia, com o documento. */
export interface AgendaNote extends AgendaDay {
  contentRich: unknown;
  content: string | null;
}

const isAgendaNote = (userId: string) =>
  and(
    eq(notes.userId, userId),
    eq(notes.type, "task"),
    isNotNull(notes.taskDate),
    ne(notes.status, "deleted")
  );

/**
 * Os dias com lista numa faixa, do mais recente para o mais antigo.
 *
 * **Não traz `content_rich` de propósito.** É para isso que `tasks_total` e
 * `tasks_done` existem: a sala mostra "5 de 7" de trinta dias sem baixar
 * trinta documentos. Quem precisa do documento pede o dia por
 * `getAgendaDay`.
 */
export async function listAgendaDays(
  userId: string,
  from: string,
  to: string
): Promise<AgendaDay[]> {
  const rows = await db
    .select({
      id: notes.id,
      date: notes.taskDate,
      title: notes.title,
      tasksTotal: notes.tasksTotal,
      tasksDone: notes.tasksDone,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(and(isAgendaNote(userId), between(notes.taskDate, from, to)))
    .orderBy(desc(notes.taskDate));

  // `date` no Drizzle volta string; o `!` é só para o TypeScript, porque a
  // consulta já filtra `isNotNull`.
  return rows.map((row) => ({ ...row, date: row.date! }));
}

/**
 * A lista de um dia, com o documento — ou `null` se aquele dia não tem lista.
 *
 * `null` é resposta normal, não erro: abrir um dia em branco é o caso comum,
 * e é o que permite a criação preguiçosa (a nota só nasce quando a pessoa
 * escreve a primeira tarefa).
 */
export async function getAgendaDay(
  userId: string,
  date: string
): Promise<AgendaNote | null> {
  const [row] = await db
    .select({
      id: notes.id,
      date: notes.taskDate,
      title: notes.title,
      content: notes.content,
      contentRich: notes.contentRich,
      tasksTotal: notes.tasksTotal,
      tasksDone: notes.tasksDone,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(and(isAgendaNote(userId), eq(notes.taskDate, date)))
    .limit(1);

  return row ? { ...row, date: row.date! } : null;
}
