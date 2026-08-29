/**
 * Os limites de cada plano, num lugar só.
 *
 * A alavanca que separa Gratuito de Pro é **limite**, nunca onde o dado mora.
 * Todo mundo grava no Postgres, com RLS e sincronização entre dispositivos —
 * inclusive quem não paga. O usuário grátis é justamente quem a gente quer
 * converter, e conhecer o produto por uma versão que perde o trabalho ao
 * limpar o navegador seria a pior primeira impressão possível.
 *
 * Ordem de grandeza, para a próxima pessoa que reabrir essa discussão: uma
 * janela ocupa ~150 bytes com overhead de linha e índice. Dez mil usuários
 * grátis no teto de 50 elementos dão ~75 MB — cerca de 1% do que já vem
 * incluído. Uma única classificação por IA custa mais do que a lousa inteira
 * daquele usuário, para sempre.
 *
 * `null` significa sem limite.
 */

export type Plan = "free" | "pro" | "enterprise";

export interface PlanLimits {
  /** Quantos workspaces a pessoa pode ter. A página de planos promete 1 no Gratuito. */
  workspaces: number | null;
  /** Quantas janelas cabem numa lousa. */
  windowsPerBoard: number | null;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { workspaces: 1, windowsPerBoard: 50 },
  pro: { workspaces: null, windowsPerBoard: null },
  enterprise: { workspaces: null, windowsPerBoard: null },
};

/**
 * Teto absoluto por lousa, válido inclusive para quem não tem limite de plano.
 *
 * Não é regra de produto: é o que impede uma lousa de virar vetor de abuso.
 * Uma pessoa com dez mil janelas abertas trava o próprio navegador antes de
 * incomodar o banco, mas a rota não pode depender disso.
 */
export const ABSOLUTE_WINDOWS_PER_BOARD = 2_000;

/**
 * Teto de ligações por lousa.
 *
 * Como o de janelas, **não é regra de produto** — é o que impede uma lousa
 * de virar vetor de abuso. Ligações crescem em cima de pares: cinquenta
 * janelas comportam 2.450 flechas possíveis, e nenhuma pessoa desenha isso à
 * mão. O número existe para o cliente adulterado, não para quem usa.
 */
export const ABSOLUTE_CONNECTIONS_PER_BOARD = 2_000;

export function limitsFor(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[(plan ?? "free") as Plan] ?? PLAN_LIMITS.free;
}

/**
 * O teto que vale de verdade para esta lousa: o do plano, ou o absoluto
 * quando o plano não impõe nenhum.
 */
export function windowCapFor(plan: string | null | undefined): number {
  const limit = limitsFor(plan).windowsPerBoard;
  return limit === null
    ? ABSOLUTE_WINDOWS_PER_BOARD
    : Math.min(limit, ABSOLUTE_WINDOWS_PER_BOARD);
}
