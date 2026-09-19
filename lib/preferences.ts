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

export const HIDE_DRAFT_KEY = "nexo-hide-draft";

/**
 * Oculta o convite "Escrever um rascunho" do dashboard.
 *
 * Desligado por padrão: o convite fica visível, como sempre foi. Ligado, ele
 * some — mas só o convite vazio. Havendo rascunho com texto já guardado no
 * `localStorage`, ele continua abrindo sozinho: texto não salvo não pode
 * ficar escondido atrás de uma preferência (mesma regra do `DraftNote`).
 */
export function readHideDraft(): boolean {
  try {
    return window.localStorage.getItem(HIDE_DRAFT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeHideDraft(on: boolean): void {
  try {
    window.localStorage.setItem(HIDE_DRAFT_KEY, on ? "1" : "0");
  } catch {
    // localStorage indisponível: a escolha vale só para esta sessão.
  }
  window.dispatchEvent(new Event(PREFERENCES_EVENT));
}

export const SIDEBAR_VIEW_KEY = "nexo-sidebar-view";

/** O que a barra lateral do dashboard lista abaixo da navegação. */
export type SidebarView = "workspaces" | "folders" | "both";

const SIDEBAR_VIEWS: readonly SidebarView[] = ["workspaces", "folders", "both"];

/**
 * Workspaces, pastas de notas, ou os dois.
 *
 * Padrão `workspaces`: é o que a barra sempre mostrou, e quem nunca criou
 * uma pasta não precisa de uma seção vazia disputando espaço.
 */
export function readSidebarView(): SidebarView {
  try {
    const value = window.localStorage.getItem(SIDEBAR_VIEW_KEY);
    return SIDEBAR_VIEWS.includes(value as SidebarView)
      ? (value as SidebarView)
      : "workspaces";
  } catch {
    return "workspaces";
  }
}

export function writeSidebarView(view: SidebarView): void {
  try {
    window.localStorage.setItem(SIDEBAR_VIEW_KEY, view);
  } catch {
    // localStorage indisponível: a escolha vale só para esta sessão.
  }
  window.dispatchEvent(new Event(PREFERENCES_EVENT));
}
