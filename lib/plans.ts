/**
 * Os limites de cada plano, num lugar só.
 *
 * **O Pro é o Gratuito sem os tetos.** Nenhuma funcionalidade existe só para
 * quem paga: enviar documento, classificar, marcar com tags, buscar, montar a
 * lousa e sincronizar entre dispositivos são de todo mundo. O que o Pro compra
 * é quantidade — mais capturas, mais workspaces, mais espaço — e, quando
 * estiver no ar, um modelo de IA mais capacitado no processamento.
 *
 * Isso não é generosidade: o usuário grátis é justamente quem a gente quer
 * converter, e conhecer o produto por uma versão capenga é a pior primeira
 * impressão possível. Ele precisa ver a coisa funcionando inteira, batendo no
 * teto — não uma demonstração com metade dos botões apagados.
 *
 * Pelo mesmo motivo a alavanca **nunca** é onde o dado mora. Todo mundo grava
 * no Postgres, com RLS e Realtime, inclusive quem não paga.
 *
 * Ordem de grandeza, para a próxima pessoa que reabrir essa discussão: uma
 * janela ocupa ~150 bytes com overhead de linha e índice. Dez mil usuários
 * grátis no teto de 50 elementos dão ~75 MB — cerca de 1% do que já vem
 * incluído. Uma única classificação por IA custa mais do que a lousa inteira
 * daquele usuário, para sempre. É por isso que o teto que importa é o de
 * **capturas**, e não o de armazenamento de layout.
 *
 * `null` significa sem limite.
 */

export type Plan = "free" | "pro" | "enterprise";

/**
 * Qual classe de modelo processa as capturas deste plano.
 *
 * `fast` são os modelos abertos e gratuitos da Groq — rápidos, e rápidos
 * importa porque a classificação roda dentro do caminho do upload, com a
 * pessoa esperando. `advanced` é o degrau que o Pro compra.
 *
 * **Hoje nada lê este campo**: `lib/ai/classify-document.ts` atende todo mundo
 * pelo mesmo provedor, e por isso a landing anuncia o modelo avançado em "Em
 * breve no Pro", não na lista do que já roda. O campo existe para o dia em que
 * a rota de classificação passar a escolher o provedor pelo plano — ver a
 * seção "Os planos" no CLAUDE.md.
 */
export type AiTier = "fast" | "advanced";

export interface PlanLimits {
  /** Quantos workspaces a pessoa pode ter. A página de planos promete 1 no Gratuito. */
  workspaces: number | null;
  /** Quantas janelas cabem numa lousa. */
  windowsPerBoard: number | null;
  /**
   * Capturas por mês — notas escritas à mão mais arquivos enviados. A página
   * de planos promete "50 capturas por mês" no Gratuito e "ilimitadas" no Pro.
   * O contador mora em `lib/usage/queries.ts`; a checagem, nas rotas que
   * criam nota ou anexo.
   */
  capturesPerMonth: number | null;
  /**
   * Soma dos arquivos guardados, em bytes. A página de planos promete 200 MB
   * no Gratuito e 20 GB no Pro — nos dois casos é um teto real, não `null`.
   */
  storageBytes: number | null;
  /** Classe de modelo que processa as capturas. Ainda não consumido — ver `AiTier`. */
  aiTier: AiTier;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    workspaces: 1,
    windowsPerBoard: 50,
    capturesPerMonth: 50,
    storageBytes: 200 * MB,
    aiTier: "fast",
  },
  pro: {
    workspaces: null,
    windowsPerBoard: null,
    capturesPerMonth: null,
    storageBytes: 20 * GB,
    aiTier: "advanced",
  },
  enterprise: {
    workspaces: null,
    windowsPerBoard: null,
    capturesPerMonth: null,
    storageBytes: null,
    aiTier: "advanced",
  },
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
