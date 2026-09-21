/**
 * A aparência de uma ligação — os valores que o inspetor oferece, o banco
 * aceita (CHECK de 0019) e o desenho sabe pintar. Um lugar só, para as três
 * pontas não discordarem sobre o que existe.
 */

export const CONNECTION_TONES = ["1", "2", "3", "4", "5", "6"] as const;
export const CONNECTION_STROKES = ["solid", "dashed", "dotted"] as const;
export const CONNECTION_WEIGHTS = ["thin", "regular", "bold"] as const;
export const CONNECTION_HEADS = ["none", "end", "both"] as const;
export const CONNECTION_SHAPES = ["straight", "curved"] as const;

export type ConnectionTone = (typeof CONNECTION_TONES)[number];
export type ConnectionStroke = (typeof CONNECTION_STROKES)[number];
export type ConnectionWeight = (typeof CONNECTION_WEIGHTS)[number];
export type ConnectionHeads = (typeof CONNECTION_HEADS)[number];
export type ConnectionShape = (typeof CONNECTION_SHAPES)[number];

export interface ConnectionStyle {
  /** Nula é o traço neutro, que acompanha o tema. */
  tone: ConnectionTone | null;
  stroke: ConnectionStroke;
  weight: ConnectionWeight;
  heads: ConnectionHeads;
  shape: ConnectionShape;
}

/** A flecha de antes de 0019 — e a de toda ligação nova. */
export const DEFAULT_CONNECTION_STYLE: ConnectionStyle = {
  tone: null,
  stroke: "solid",
  weight: "regular",
  heads: "end",
  shape: "straight",
};

/** Espessura aparente do traço, em pixels de tela. */
export const WEIGHT_PX: Record<ConnectionWeight, number> = {
  thin: 1.25,
  regular: 1.75,
  bold: 3,
};

/**
 * A barriga que a curva ganha ao ser ligada pelo inspetor, em unidades de
 * lousa — antes de a pessoa arrastar a alça pela primeira vez.
 *
 * Sem isto, escolher "Curva" com `bendT`/`bendOffset` ainda nulos desenharia
 * uma reta idêntica à de antes (`bendOffset` nulo vale zero em
 * `bendPointOf`): o clique pareceria não ter feito nada. O valor é modesto
 * de propósito — só o bastante para a curva se anunciar antes do primeiro
 * ajuste.
 */
export const DEFAULT_BEND_OFFSET = 40;

/**
 * O tracejado, em múltiplos da espessura.
 *
 * Proporcional ao traço, e não fixo: um tracejado de 6px num traço grosso
 * vira uma fila de quadrados, e num fino some.
 */
export function dashArrayOf(
  stroke: ConnectionStroke,
  width: number
): string | undefined {
  if (stroke === "dashed") return `${width * 4} ${width * 3}`;
  // Com `strokeLinecap="round"`, um traço de comprimento zero é um ponto.
  if (stroke === "dotted") return `0 ${width * 2.5}`;
  return undefined;
}

/** A cor do traço e do texto, pela paleta semântica — acompanha os temas. */
export const CONNECTION_TONE_CLASS: Record<ConnectionTone, string> = {
  "1": "text-tag-1-foreground",
  "2": "text-tag-2-foreground",
  "3": "text-tag-3-foreground",
  "4": "text-tag-4-foreground",
  "5": "text-tag-5-foreground",
  "6": "text-tag-6-foreground",
};
