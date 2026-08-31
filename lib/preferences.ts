/**
 * Preferências de interface que moram no navegador.
 *
 * Como o tema (`lib/theme.ts`), são escolhas de vista, não conteúdo: perder
 * uma ao limpar o navegador não é perder trabalho da pessoa, e faz sentido
 * elas serem por aparelho — um desktop forte pode querer o editor rico na
 * lousa que um celular fraco não aguenta.
 */

export const BOARD_RICH_EDITOR_KEY = "nexo-board-rich-editor";

/** Disparado no mesmo separador quando uma preferência muda. */
export const PREFERENCES_EVENT = "nexo-preferences";

/**
 * O editor rico (TipTap) na janela de nota da lousa.
 *
 * Desligado por padrão: a janela usa um `textarea` leve. Ligado, ela carrega
 * o mesmo editor da nota inteira — títulos, listas, bloco de código,
 * checklist — ao custo de baixar o ProseMirror e de mais peso numa lousa com
 * muitas janelas.
 */
export function readBoardRichEditor(): boolean {
  try {
    return window.localStorage.getItem(BOARD_RICH_EDITOR_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeBoardRichEditor(on: boolean): void {
  try {
    window.localStorage.setItem(BOARD_RICH_EDITOR_KEY, on ? "1" : "0");
  } catch {
    // localStorage indisponível: a escolha vale só para esta sessão.
  }
  // `storage` só chega nos outros separadores; este evento avisa o atual.
  window.dispatchEvent(new Event(PREFERENCES_EVENT));
}
