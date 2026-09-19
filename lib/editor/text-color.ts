import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * A cor do texto, como marca do documento.
 *
 * **Guarda o nome da cor, não o valor.** A extensão `Color` do TipTap grava
 * `style="color: #…"` — um vermelho escolhido no tema claro ficaria escuro
 * demais no escuro, e o contrário. Aqui o documento guarda `red`, o HTML sai
 * `<span data-text-color="red">`, e o valor de cada tema (e o do papel, no
 * PDF) mora no `globals.css`, nas variáveis `--nx-ink-*`.
 *
 * Colar texto colorido de outro site não traz a cor: só `data-text-color`
 * com um nome da paleta é lido. A nota continua com as cores do Nexo.
 *
 * Mora nas extensões compartilhadas (`buildEditorExtensions`), não só na
 * nota: um documento com a marca aberto num schema que não a conhecesse — o
 * rascunho, a janela da lousa — seria recusado inteiro.
 */
export const TEXT_COLORS = [
  { id: "red", name: "Vermelho" },
  { id: "orange", name: "Laranja" },
  { id: "yellow", name: "Amarelo" },
  { id: "green", name: "Verde" },
  { id: "blue", name: "Azul" },
  { id: "purple", name: "Roxo" },
  { id: "pink", name: "Rosa" },
] as const;

export type TextColorId = (typeof TEXT_COLORS)[number]["id"];

function isTextColor(value: unknown): value is TextColorId {
  return TEXT_COLORS.some((color) => color.id === value);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: TextColorId) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
  }
}

export const TextColor = Mark.create({
  name: "textColor",
  // Abaixo das marcas da StarterKit (100): no HTML o `span` fica por dentro
  // de `strong` e `a`, e a cor vale sobre a cor que eles próprios trazem.
  priority: 50,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("data-text-color");
          return isTextColor(value) ? value : null;
        },
        renderHTML: (attributes) =>
          isTextColor(attributes.color)
            ? { "data-text-color": attributes.color }
            : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-text-color]",
        getAttrs: (element) =>
          isTextColor(element.getAttribute("data-text-color")) ? null : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/** A cor ativa na seleção, ou `null` quando o texto está na cor padrão. */
export function activeTextColor(
  attributes: Record<string, unknown>
): TextColorId | null {
  return isTextColor(attributes.color) ? attributes.color : null;
}
