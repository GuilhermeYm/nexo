export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "nexo-theme";

/**
 * Script inline executado durante o parse do HTML, antes do primeiro paint.
 * Lê o tema salvo (ou a preferência do sistema, no primeiro acesso) e escreve
 * o atributo data-theme em <html>, evitando o flash de tema incorreto.
 * Ver node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});if(t!=="dark"&&t!=="light"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

/** Mesma decisão do script inline, para reaplicar no cliente quando preciso. */
export function resolveTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // localStorage indisponível (modo privado, storage bloqueado).
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

/** O tema em vigor agora, lido de onde ele de fato mora: o DOM. */
export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}
