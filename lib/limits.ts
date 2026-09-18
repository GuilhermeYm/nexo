/**
 * Os tetos absolutos de uma lousa.
 *
 * **Não são regra de produto.** Não existe plano, cobrança nem teto de
 * captura nesta aplicação: cada pessoa sobe a própria instância e paga o
 * próprio Supabase, então quem limita o acervo é a conta dela — não uma
 * regra nossa. O que sobra aqui é só o que impede uma lousa de virar vetor
 * de abuso por um cliente adulterado.
 *
 * Uma pessoa com dez mil janelas trava o próprio navegador antes de
 * incomodar o banco, mas a rota não pode depender disso. E ligações crescem
 * em cima de pares: cinquenta janelas comportam 2.450 flechas possíveis, e
 * ninguém desenha isso à mão.
 */
export const ABSOLUTE_WINDOWS_PER_BOARD = 2_000;

export const ABSOLUTE_CONNECTIONS_PER_BOARD = 2_000;
