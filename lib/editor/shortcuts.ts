/**
 * Os atalhos do editor, escritos uma vez.
 *
 * A barra fixa e o bubble menu mostram o mesmo `title` ao passar o mouse —
 * atalho + uma descrição de três palavras —, e é daqui que os dois leem. O
 * texto do atalho segue o teclado: `⌘` no Mac, `Ctrl` no resto.
 *
 * `navigator` não existe no servidor. Nenhum consumidor renderiza a dica
 * durante o SSR (a barra só pinta botão com `editor` montado, que é
 * client-only), mas o `?.` mantém o módulo seguro se isso mudar.
 */
const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? navigator.userAgent ?? "");

/** `⌘` no Mac, `Ctrl` fora dele. */
export const MOD = isMac ? "⌘" : "Ctrl";
const ALT = isMac ? "⌥" : "Alt";
const SHIFT = "⇧";

/**
 * `title` de cada controle: atalho e o que ele faz.
 *
 * As chaves batem com os nomes de marca/nó do TipTap onde faz sentido, para o
 * consumidor pedir `HINTS[editor.isActive(...) ? ...]` sem um segundo mapa.
 */
export const HINTS: Record<string, string> = {
  bold: `${MOD}B · negrito`,
  italic: `${MOD}I · itálico`,
  underline: `${MOD}U · sublinhado`,
  strike: `${MOD}${SHIFT}S · tachado`,
  code: `${MOD}E · código`,
  highlight: `${MOD}${SHIFT}H · marca-texto`,
  link: `${MOD}K · link`,
  heading1: `${MOD}${ALT}1 · título`,
  heading2: `${MOD}${ALT}2 · subtítulo`,
  heading3: `${MOD}${ALT}3 · subtítulo menor`,
  bulletList: `${MOD}${SHIFT}8 · lista`,
  orderedList: `${MOD}${SHIFT}7 · lista numerada`,
  taskList: `${MOD}${SHIFT}9 · lista de tarefas`,
  blockquote: `${MOD}${SHIFT}B · citação`,
  codeBlock: `${MOD}${ALT}C · bloco de código`,
  horizontalRule: `--- · linha divisória`,
  details: `${MOD}${ALT}D · bloco recolhível`,
};
