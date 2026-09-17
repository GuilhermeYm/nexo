import type { CSSProperties } from "react";

/**
 * O fundo da lousa.
 *
 * Duas escolhas independentes, e é de propósito: **a trama** (pontos, grade,
 * pauta, liso) e **a cor da superfície** (neutra ou uma das seis da paleta).
 * Quem quer papel milimetrado e quem quer papel colorido estão pedindo coisas
 * diferentes, e uma lista única com as doze combinações seria uma lista que
 * ninguém lê.
 *
 * Os valores moram aqui e em lugar nenhum mais: o Zod da rota, o CHECK do
 * banco (0021) e as amostras do inspetor leem destas mesmas constantes.
 *
 * **As cores saem da camada `--nx-*`, nunca da `--color-*`.** O Tailwind v4
 * inlina os tokens de `@theme inline` dentro das utilities em vez de publicar
 * a variável, então `var(--color-tag-1)` dentro de um `style` inline resolve
 * para vazio — e um `background-image` inválido é descartado sem erro, com a
 * lousa ficando com a trama anterior. Mesma armadilha do canvas das tags.
 */

export const BOARD_PATTERNS = ["dots", "grid", "lines", "plain"] as const;
export type BoardPattern = (typeof BOARD_PATTERNS)[number];

export const BOARD_TONES = ["1", "2", "3", "4", "5", "6"] as const;
export type BoardTone = (typeof BOARD_TONES)[number];

/** A lousa de sempre: pontos sobre a superfície neutra. */
export const DEFAULT_BOARD_PATTERN: BoardPattern = "dots";

/** Espaçamento da trama, em pixels de lousa. */
export const BOARD_PATTERN_SPACING = 24;

/**
 * Abaixo disto a trama vira um borrão cinza em vez de uma referência.
 * Afastando o zoom, o espaçamento dobra — o desenho continua legível e
 * continua ancorado nos mesmos múltiplos.
 */
const MIN_PATTERN_STEP = 12;

export const BOARD_PATTERN_LABEL: Record<BoardPattern, string> = {
  dots: "Pontos",
  grid: "Grade",
  lines: "Pauta",
  plain: "Liso",
};

export const BOARD_TONE_SURFACE: Record<BoardTone, string> = {
  "1": "bg-tag-1",
  "2": "bg-tag-2",
  "3": "bg-tag-3",
  "4": "bg-tag-4",
  "5": "bg-tag-5",
  "6": "bg-tag-6",
};

export interface BoardBackground {
  pattern: BoardPattern;
  /** Nulo é a superfície neutra — a lousa como ela sempre foi. */
  tone: BoardTone | null;
}

export function isBoardPattern(value: unknown): value is BoardPattern {
  return BOARD_PATTERNS.includes(value as BoardPattern);
}

export function isBoardTone(value: unknown): value is BoardTone {
  return BOARD_TONES.includes(value as BoardTone);
}

/**
 * Normaliza o que veio do banco.
 *
 * Uma linha antiga tem as duas colunas nulas, e uma trama que o banco aceitou
 * antes de um CHECK novo não pode derrubar a lousa: o desconhecido cai no
 * padrão em vez de virar `undefined` no meio de um `style`.
 */
export function toBoardBackground(
  pattern: string | null,
  tone: string | null
): BoardBackground {
  return {
    pattern: isBoardPattern(pattern) ? pattern : DEFAULT_BOARD_PATTERN,
    tone: isBoardTone(tone) ? tone : null,
  };
}

/** A superfície, como classe do Tailwind. */
export function boardSurfaceClass(tone: BoardTone | null): string {
  return tone === null ? "bg-tertiary" : BOARD_TONE_SURFACE[tone];
}

/**
 * A cor do traço da trama.
 *
 * Sobre a superfície neutra é a borda de sempre. Sobre uma superfície
 * colorida, a borda some — ela foi escolhida para contrastar com o papel, não
 * com o tom —, então o traço puxa o próprio texto daquela matiz, diluído.
 */
function patternColor(tone: BoardTone | null): string {
  return tone === null
    ? "var(--nx-border)"
    : `color-mix(in srgb, var(--nx-tag-${tone}-text) 30%, transparent)`;
}

/**
 * A trama, já ancorada no enquadramento.
 *
 * Ela acompanha pan e zoom porque é o que dá à lousa a sensação de
 * superfície: sem referência visual, arrastar no vazio não parece movimento.
 */
export function boardBackgroundStyle(
  background: BoardBackground,
  viewport: { x: number; y: number; zoom: number }
): CSSProperties {
  if (background.pattern === "plain") return {};

  let step = BOARD_PATTERN_SPACING * viewport.zoom;
  while (step > 0 && step < MIN_PATTERN_STEP) step *= 2;

  const color = patternColor(background.tone);
  const size = `${step}px ${step}px`;
  const position = `${viewport.x}px ${viewport.y}px`;

  if (background.pattern === "dots") {
    return {
      backgroundImage: `radial-gradient(circle, ${color} 1px, transparent 1px)`,
      backgroundSize: size,
      backgroundPosition: position,
    };
  }

  if (background.pattern === "grid") {
    return {
      backgroundImage: `linear-gradient(to right, ${color} 1px, transparent 1px), linear-gradient(to bottom, ${color} 1px, transparent 1px)`,
      backgroundSize: size,
      backgroundPosition: position,
    };
  }

  // Pauta: só as horizontais, como papel de caderno.
  return {
    backgroundImage: `linear-gradient(to bottom, ${color} 1px, transparent 1px)`,
    backgroundSize: size,
    backgroundPosition: position,
  };
}
