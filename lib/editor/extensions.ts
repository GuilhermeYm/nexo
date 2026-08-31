import { Extension, type Extensions } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Typography } from "@tiptap/extension-typography";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";

import { lowlight } from "@/lib/editor/lowlight";
import { SlashCommand } from "@/lib/editor/slash-command";

/**
 * As extensões do editor, montadas num lugar só.
 *
 * Três telas usam TipTap — a nota (`/nota/[id]`), o rascunho do dashboard e a
 * janela de nota da lousa — e todas passam por aqui. É o mesmo princípio do
 * `PROSE_EDITOR_CLASS`: a tipografia e o vocabulário do editor moram num
 * arquivo, e as telas só diferem na moldura (barra fixa, bubble menu, altura).
 *
 * O que muda por tela é pouco:
 * - `placeholder` — o texto do primeiro parágrafo vazio.
 * - `slash` — o menu "/" entra na nota e no rascunho; na lousa não, onde uma
 *   lista larga atrapalharia e o bubble menu já resolve.
 *
 * `immediatelyRender: false` continua em cada `useEditor` (obrigatório no App
 * Router), não aqui.
 */

interface BuildOptions {
  placeholder: string;
  /** O menu "/". Fora da lousa. */
  slash: boolean;
}

/**
 * `Mod+Alt+D` recolhe/expande um bloco de detalhes.
 *
 * A extensão `Details` só amarra Backspace e Enter (comportamento de edição);
 * o atalho de criar/desfazer o bloco é nosso, para casar com a coluna de
 * `HINTS` que a barra e o bubble menu exibem.
 */
const DetailsShortcut = Extension.create({
  name: "detailsShortcut",
  addKeyboardShortcuts() {
    return {
      // A extensão `Details` só traz `setDetails`/`unsetDetails` — o alternar é
      // nosso.
      "Mod-Alt-d": () =>
        this.editor.isActive("details")
          ? this.editor.commands.unsetDetails()
          : this.editor.commands.setDetails(),
    };
  },
});

export function buildEditorExtensions({
  placeholder,
  slash,
}: BuildOptions): Extensions {
  return [
    StarterKit.configure({
      // O `codeBlock` simples sai para o `CodeBlockLowlight` entrar no lugar
      // dele — os dois usam o mesmo nó `codeBlock`, então não podem coexistir.
      codeBlock: false,
      link: {
        openOnClick: false,
        HTMLAttributes: {
          rel: "noreferrer noopener",
          target: "_blank",
        },
      },
    }),
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: null,
      HTMLAttributes: { spellcheck: "false" },
    }),
    // Marca-texto de cor única: uma cor só combina com os dois temas sem um
    // seletor de cores, e o realce é sobre "olha isto", não sobre categorizar.
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    Details.configure({
      persist: true,
      HTMLAttributes: { class: "nx-details" },
    }),
    DetailsSummary,
    DetailsContent,
    DetailsShortcut,
    // Aspas curvas, travessão, reticências e setas enquanto se digita.
    // Determinístico e desfeito por Ctrl+Z como qualquer outra edição.
    Typography,
    Placeholder.configure({ placeholder }),
    ...(slash ? [SlashCommand] : []),
  ];
}
