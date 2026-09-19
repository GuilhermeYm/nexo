import "server-only";

import { logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

/**
 * Escrever na Entrada como Nexo.
 *
 * **Quem pode escrever.** Ninguém pelo navegador: a migration 0011 revoga
 * `INSERT` e `DELETE` de `authenticated` e de `anon`, e não existe rota de
 * criação. Quem escreve é o servidor, e escreve por aqui — o `db` do Drizzle
 * entra pela `DATABASE_URL` como `postgres`, que passa por cima da RLS e dos
 * GRANTs. É a mesma porta de `writeAuditLog`.
 *
 * Ou seja: **não há como forjar uma notificação de sistema.** É o que faz o
 * selo "Nexo" na Entrada valer alguma coisa; se o cliente pudesse inserir,
 * um "sua senha expirou, clique aqui" viria com a mesma cara de oficial.
 *
 * **Falhar aqui não derruba nada.** Mesmo contrato do audit log e da escrita
 * em `ai_jobs`: a notificação é sobre o que aconteceu, não é o que aconteceu.
 * Se a cota estourou e o aviso não foi gravado, a cota continua estourada e a
 * resposta ao usuário continua correta.
 *
 * **Quem mais escreve na Entrada.** A trigger `handle_new_user` (as
 * boas-vindas, em SQL, porque acontece dentro do INSERT em `auth.users`), a
 * trigger de `ai_jobs` de 0031 (o fim de cada tarefa — são
 * cinco workers, e nenhum precisa lembrar), o `pg_cron` do resumo de limites
 * (0025) e os CLIs `bun run notify` e `bun run errors`. Daqui saem o aviso
 * de limite de leituras e o do reset da conta.
 *
 * **Num caminho que repete**, `metadata.dedupeKey` + o índice único de 0025:
 * o mesmo evento não entra duas vezes.
 */

/** Teto do título: é uma linha de lista, não um parágrafo. */
const MAX_TITLE = 200;
/** Teto do corpo: o que não cabe aqui merece ser uma nota, não um aviso. */
const MAX_BODY = 2000;

export interface SystemNotification {
  /** Sempre de dentro do servidor — nunca de um corpo de requisição. */
  userId: string;
  title: string;
  body?: string | null;
  /**
   * Dados estruturados do evento: para onde o aviso leva, qual recurso ele
   * cita. Nunca token, senha ou caminho do Storage — a Entrada é lida pelo
   * cliente inteira.
   */
  metadata?: Record<string, unknown> | null;
}

/**
 * Uma notificação de sistema para uma pessoa.
 *
 * Não lança: o chamador não precisa de `try/catch` e não deve mudar a
 * resposta dele por causa disto.
 */
export async function notifySystem(input: SystemNotification): Promise<void> {
  await notifyManySystem([input]);
}

/**
 * Várias de uma vez — um `INSERT` só.
 *
 * É o caminho do anúncio para a base inteira. Uma inserção por pessoa faria
 * mil idas ao banco para uma frase que é a mesma em todas elas.
 *
 * Devolve quantas entraram, para quem chama poder relatar. Zero também é uma
 * resposta possível: a lista veio vazia, ou a escrita falhou (e o erro foi
 * para o log do servidor, não para o cliente).
 */
export async function notifyManySystem(
  inputs: SystemNotification[]
): Promise<number> {
  const rows = inputs.flatMap((input) => {
    const title = input.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
    // Sem título não há notificação: a lista da Entrada mostra o título em
    // negrito e o corpo abaixo. Uma linha só com corpo lê como texto solto.
    if (title.length === 0) return [];

    const body = input.body?.trim().slice(0, MAX_BODY) || null;

    return [
      {
        userId: input.userId,
        type: "system" as const,
        title,
        body,
        metadata: input.metadata ?? null,
      },
    ];
  });

  if (rows.length === 0) return 0;

  try {
    // `metadata.dedupeKey` + o índice único de 0025: o mesmo evento não
    // entra duas vezes. Sem chave, nada conflita e a linha entra normalmente.
    const inserted = await db
      .insert(notifications)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    return inserted.length;
  } catch (error) {
    logServerError("notifyManySystem", error, { count: rows.length });
    return 0;
  }
}
