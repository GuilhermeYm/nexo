import { Caveat, JetBrains_Mono } from "next/font/google";
import type { CSSProperties } from "react";

import type { NoteFontId } from "@/lib/editor/note-fonts";

/**
 * O carregamento das fontes da nota (a lista mora em `lib/editor/note-fonts.ts`).
 *
 * `preload: false` em todas: o `@font-face` entra no CSS da rota, mas o
 * arquivo só desce quando algum texto passa a usar a família — quem nunca
 * troca a fonte não paga por nenhuma. Geist e Geist Mono já vêm do layout.
 */
const caveat = Caveat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-note-manuscrita",
  preload: false,
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-note-mono",
  preload: false,
});

/** As classes que publicam as variáveis `--font-note-*`. Vão num ancestral. */
export const NOTE_FONT_VARIABLES = [
  caveat.variable,
  jetbrainsMono.variable,
].join(" ");

const FAMILY: Record<Exclude<NoteFontId, "default">, string> = {
  mono: "var(--font-note-mono)",
  manuscrita: "var(--font-note-manuscrita)",
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
