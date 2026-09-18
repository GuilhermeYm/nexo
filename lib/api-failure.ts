import { isErrorCode } from "@/lib/errors/code";

/**
 * Ler a recusa do servidor do lado do cliente.
 *
 * A contrapartida de `errorResponse` (`lib/api.ts`): a mensagem já pronta
 * para exibição, mais o código do relatório quando houve defeito.
 */

export interface ApiFailure {
  /** A mensagem já pronta para exibição, vinda do servidor. */
  message: string;
  /**
   * O código do relatório de erro (`NX-7F3A-2K9`), quando houve um.
   *
   * Existe só onde houve **defeito**: 500 e afins. 404 não tem código,
   * validação não tem código — nenhum dos dois é um erro nosso para
   * investigar, e oferecer "reportar" neles ensinaria a pessoa a mandar
   * chamado sobre o produto funcionando.
   *
   * Vem como campo próprio do JSON, e não recortado da frase: o dia em que
   * alguém reescrever a mensagem não pode ser o dia em que o botão de
   * reportar some.
   */
  code: string | null;
}

/**
 * Extrai a falha de uma resposta que não veio `ok`.
 *
 * `fallback` cobre o corpo ilegível (um 502 do proxy devolve HTML, não JSON) —
 * sem ele a interface mostraria "undefined" no lugar do problema.
 */
export async function readApiFailure(
  response: Response,
  fallback: string
): Promise<ApiFailure> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    code?: unknown;
  } | null;

  return {
    message:
      typeof body?.error === "string" && body.error.trim().length > 0
        ? body.error
        : fallback,
    code: isErrorCode(body?.code) ? body.code : null,
  };
}
