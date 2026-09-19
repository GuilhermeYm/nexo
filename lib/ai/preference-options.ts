/**
 * As escolhas de IA da conta — vocabulário compartilhado entre a tela de
 * Configurações, a rota que grava e o servidor que lê. Sem nada de servidor,
 * para o cliente poder importar.
 */

export const REASONING_EFFORTS = ["low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const LIMIT_NOTICES = ["immediate", "daily", "off"] as const;
export type LimitNotice = (typeof LIMIT_NOTICES)[number];

export interface AiPreferences {
  reasoningEffort: ReasoningEffort;
  limitNotice: LimitNotice;
}

export const DEFAULT_AI_PREFERENCES: AiPreferences = {
  reasoningEffort: "low",
  limitNotice: "immediate",
};

/** Só modelos de raciocínio aceitam `reasoning_effort`; nos outros é erro 400. */
export function supportsReasoningEffort(model: string): boolean {
  return /gpt-oss|^o\d|^gpt-5/i.test(model);
}

/** Quantas leituras extras o botão "Ler mesmo assim" libera por nota, no dia. */
export const EXTRA_READS_PER_RELEASE = 3;
