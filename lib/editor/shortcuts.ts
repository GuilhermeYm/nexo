/**
 * Os atalhos do editor, escritos uma vez.
 *
 * Guardamos **a ação e as teclas separadas**, não uma frase pronta: quem
 * mostra decide o desenho. A barra e o bubble menu desenham as teclas em
 * `kbd`, o menu "/" mostra só as teclas (o nome do bloco já está na linha), e
 * o leitor de tela recebe o nome da ação mais um `aria-keyshortcuts` de
 * verdade. Uma string única ("⌘B · negrito") servia para as três coisas e não
 * servia bem para nenhuma.
 *
 * O texto das teclas segue o teclado: `⌘` no Mac, `Ctrl` no resto.
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
// Fora do Mac a tecla é escrita: o teclado diz "Shift", e a seta sozinha numa
// cápsula pequena some. No Mac os símbolos são a convenção do sistema.
const SHIFT = isMac ? "⇧" : "Shift";

export interface Shortcut {
  /** O que a tecla faz, em uma ou duas palavras. */
  label: string;
  /** Uma tecla por cápsula, na ordem em que se aperta. */
  keys: readonly string[];
  /**
   * `typed` é o que a pessoa **digita** no texto (`---` vira uma linha), não
   * uma combinação: não vira `aria-keyshortcuts` nem se desenha como tecla.
   */
  kind?: "typed";
}

/**
 * As chaves batem com os nomes de marca/nó do TipTap onde faz sentido, para o
 * consumidor pedir `SHORTCUTS[editor.isActive(...) ? ...]` sem um segundo mapa.
 */
export const SHORTCUTS = {
  bold: { label: "Negrito", keys: [MOD, "B"] },
  italic: { label: "Itálico", keys: [MOD, "I"] },
  underline: { label: "Sublinhado", keys: [MOD, "U"] },
  strike: { label: "Tachado", keys: [MOD, SHIFT, "S"] },
  code: { label: "Código", keys: [MOD, "E"] },
  highlight: { label: "Marca-texto", keys: [MOD, SHIFT, "H"] },
  link: { label: "Link", keys: [MOD, "K"] },
  heading1: { label: "Título", keys: [MOD, ALT, "1"] },
  heading2: { label: "Subtítulo", keys: [MOD, ALT, "2"] },
  heading3: { label: "Subtítulo menor", keys: [MOD, ALT, "3"] },
  bulletList: { label: "Lista", keys: [MOD, SHIFT, "8"] },
  orderedList: { label: "Lista numerada", keys: [MOD, SHIFT, "7"] },
  taskList: { label: "Lista de tarefas", keys: [MOD, SHIFT, "9"] },
  blockquote: { label: "Citação", keys: [MOD, SHIFT, "B"] },
  codeBlock: { label: "Bloco de código", keys: [MOD, ALT, "C"] },
  horizontalRule: {
    label: "Linha divisória",
    keys: ["---"],
    kind: "typed",
  },
  details: { label: "Bloco recolhível", keys: [MOD, ALT, "D"] },
} as const satisfies Record<string, Shortcut>;

export type ShortcutName = keyof typeof SHORTCUTS;

const ARIA_KEY: Record<string, string> = {
  [MOD]: isMac ? "Meta" : "Control",
  [ALT]: "Alt",
  [SHIFT]: "Shift",
};

/** `Control+Shift+S` — o formato que o `aria-keyshortcuts` espera. */
export function ariaKeyshortcuts(shortcut: Shortcut): string | undefined {
  if (shortcut.kind === "typed") return undefined;
  return shortcut.keys.map((key) => ARIA_KEY[key] ?? key).join("+");
}
