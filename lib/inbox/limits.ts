/**
 * Os tetos da Entrada — num arquivo sem `server-only`, porque a tela também
 * precisa saber deles (o aviso de "mostrando as mais recentes").
 */

/**
 * Quantas a Entrada carrega. Desde 0031 cada tarefa que termina escreve
 * aqui, então a tabela cresce com o uso — a lista mostra as mais recentes, e
 * o resto continua no banco até a pessoa apagar.
 */
export const NOTIFICATIONS_LIMIT = 200;

/** Quantas uma ação em lote (marcar, apagar) aceita de uma vez. */
export const NOTIFICATIONS_BATCH_MAX = NOTIFICATIONS_LIMIT;
