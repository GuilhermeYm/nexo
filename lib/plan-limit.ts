/**
 * Ler a recusa por teto de plano do lado do cliente.
 *
 * A contrapartida de `planLimitResponse` (`lib/api.ts`). O servidor marca a
 * resposta com `upgrade: true`, e é essa marca — não o status, não o texto —
 * que a interface usa para decidir entre mostrar cara de erro ou cara de
 * convite.
 *
 * Por que não olhar o status: 409 também sai quando a nota já está aberta na
 * lousa, e 413 também sai quando o arquivo passa de 25 MB. Os dois são
 * problemas de verdade, e nenhum deles se resolve assinando o Pro.
 *
 * Por que não olhar o texto: procurar "Pro" na mensagem funcionaria até
 * alguém reescrever a frase.
 */

export interface ApiFailure {
  /** A mensagem já pronta para exibição, vinda do servidor. */
  message: string;
  /** `true` quando a recusa foi um teto de plano, não um defeito. */
  upgrade: boolean;
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
    upgrade?: unknown;
  } | null;

  return {
    message:
      typeof body?.error === "string" && body.error.trim().length > 0
        ? body.error
        : fallback,
    upgrade: body?.upgrade === true,
  };
}
