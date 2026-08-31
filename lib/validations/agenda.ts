import { z } from "zod";

import { DAY_KEY_PATTERN, isDayKey } from "@/lib/agenda/day";
import { richDocumentSchema } from "@/lib/editor/document";

/**
 * A validação do dia da Agenda.
 *
 * Fica separada de `lib/agenda/day.ts` de propósito: aquele arquivo é puro e
 * desce no bundle do cliente (é ele que decide qual dia a pessoa está
 * olhando), e não há motivo para arrastar o Zod junto por causa de um regex.
 *
 * ## Por que o dia vem do cliente, e por que isso não é confiar nele
 *
 * O projeto usa UTC no banco (`date_trunc('month', now())`) e está certo lá:
 * o mês da cota é régua administrativa, e o mesmo corte para todo mundo é uma
 * virtude. Um dia de tarefas é o oposto — ele só existe do ponto de vista de
 * alguém olhando um relógio. Aplicar UTC aqui não seria consistência, seria
 * levar a régua errada para o problema errado, e o sintoma seria a pessoa em
 * UTC−3 escrevendo às 21h na lista de amanhã.
 *
 * E `task_date` não é uma afirmação sobre o mundo: é **parâmetro de
 * navegação**, da mesma natureza do `id` em `/nota/[id]`. A pessoa está
 * escolhendo qual lista *dela* abrir, e já pode escolher qualquer dia pela
 * própria interface. O pior que uma data forjada faz é criar a lista dela num
 * dia dela. Nada que o servidor considera seu — `user_id`, `content`,
 * `tasks_total`, `tasks_done` — vem do corpo.
 */

/** Um ano para trás e para a frente, com folga. */
const RANGE_DAYS = 370;

export const agendaDateSchema = z
  .string()
  .regex(DAY_KEY_PATTERN, "Data inválida.")
  // `2026-02-31` passa no regex, e sem esta checagem o Postgres responderia
  // 22008 — ou seja, um 500 causado por entrada do usuário.
  .refine(isDayKey, "Data inválida.")
  // A faixa não protege contra nada perigoso: protege contra a coluna `date`
  // guardando `0001-01-01` e contra o índice único virar espaço de
  // endereçamento infinito. ±370 engole com sobra o fuso mais extremo em uso
  // (UTC−12 a UTC+14) — o "hoje" de qualquer pessoa está a no máximo um dia
  // do "hoje" UTC do servidor.
  .refine((value) => {
    const delta = Math.abs(Date.parse(`${value}T00:00:00Z`) - Date.now());
    return delta <= RANGE_DAYS * 86_400_000;
  }, "Data fora do intervalo da Agenda.");

/**
 * O corpo do `PUT`.
 *
 * `contentRich` é opcional porque o `PUT` também serve para abrir um dia que
 * já existe. E é a única coisa que o cliente manda: `tasksTotal`, `tasksDone`
 * e `taskDate` não aparecem aqui — o dia vem do caminho e os contadores são
 * derivados no servidor. Como `z.object` descarta chave desconhecida, um
 * `{ tasksDone: 99 }` forjado nem chega ao `set()`.
 */
export const putAgendaSchema = z.object({
  contentRich: richDocumentSchema.optional(),
});

/** A faixa que a sala lê de uma vez. */
export const agendaRangeSchema = z.object({
  from: agendaDateSchema,
  to: agendaDateSchema,
});
