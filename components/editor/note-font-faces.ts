import {
  Atkinson_Hyperlegible_Next,
  Literata,
  Lora,
  Nunito,
} from "next/font/google";
import type { CSSProperties } from "react";

import type { NoteFontId } from "@/lib/editor/note-fonts";

/**
 * O carregamento das fontes da nota (a lista mora em `lib/editor/note-fonts.ts`).
 *
 * `preload: false` em todas: o `@font-face` entra no CSS da rota, mas o
 * arquivo só desce quando algum texto passa a usar a família — quem nunca
 * troca a fonte não paga por nenhuma. Geist e Geist Mono já vêm do layout.
 */
const literata = Literata({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-note-literata",
  preload: false,
});

const lora = Lora({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-note-lora",
  preload: false,
});

const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-note-atkinson",
  preload: false,
});

const nunito = Nunito({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-note-nunito",
  preload: false,
});

/** As classes que publicam as variáveis `--font-note-*`. Vão num ancestral. */
export const NOTE_FONT_VARIABLES = [
  literata.variable,
  lora.variable,
  atkinson.variable,
  nunito.variable,
].join(" ");

const FAMILY: Record<Exclude<NoteFontId, "default">, string> = {
  literata: "var(--font-note-literata)",
  lora: "var(--font-note-lora)",
  atkinson: "var(--font-note-atkinson)",
  nunito: "var(--font-note-nunito)",
  mono: "var(--font-geist-mono)",
};

/** A família de uma fonte, para desenhar o nome dela no próprio menu. */
export function noteFontFamily(id: NoteFontId): string {
  return id === "default" ? "var(--font-geist-sans)" : FAMILY[id];
}

/**
 * O estilo do documento com a fonte escolhida.
 *
 * O corpo herda o `font-family`; os títulos (o da nota, h1 e h2) usam
 * `--font-display`, e é redefinindo a variável só dentro do documento que eles
 * acompanham a fonte. Na fonte padrão nada muda: o título continua em Space
 * Grotesk, como sempre foi.
 */
export function noteFontStyle(id: NoteFontId): CSSProperties | undefined {
  if (id === "default") return undefined;
  return {
    fontFamily: FAMILY[id],
    ["--font-display" as string]: FAMILY[id],
  };
}
