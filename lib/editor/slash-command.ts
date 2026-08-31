import { Extension } from "@tiptap/core";
import Suggestion, {
  type SuggestionOptions,
} from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  Quote,
  SquareCode,
  Type,
} from "lucide-react";

import {
  SlashMenuList,
  type SlashItem,
  type SlashMenuHandle,
} from "@/components/editor/editor-slash-menu";
import { HINTS } from "@/lib/editor/shortcuts";

/**
 * O menu "/" — inserir um bloco sem soltar o teclado.
 *
 * Fica ligado no editor inteiro e no rascunho; na janela da lousa não, onde o
 * bubble menu, os input rules (` ``` `, `-`, `1.`, `---`) e os atalhos já dão
 * conta e uma lista de 340px de largura seria um estorvo.
 *
 * O posicionamento é da própria biblioteca: a API `mount` do
 * `@tiptap/suggestion` v3 coloca o elemento no `body`, ancora no cursor e
 * reposiciona no scroll e no resize sozinha.
 */

/** Os blocos que o "/" oferece, na ordem em que aparecem. */
export const SLASH_ITEMS: SlashItem[] = [
  {
    title: "Texto",
    keywords: ["texto", "paragrafo", "paragraph", "p"],
    icon: Type,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    title: "Título",
    hint: HINTS.heading1,
    keywords: ["titulo", "h1", "heading"],
    icon: Heading1,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    title: "Subtítulo",
    hint: HINTS.heading2,
    keywords: ["subtitulo", "h2", "heading"],
    icon: Heading2,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Subtítulo menor",
    hint: HINTS.heading3,
    keywords: ["subtitulo", "h3", "heading"],
    icon: Heading3,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Lista",
    hint: HINTS.bulletList,
    keywords: ["lista", "bullet", "ul", "topicos"],
    icon: List,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Lista numerada",
    hint: HINTS.orderedList,
    keywords: ["lista", "numerada", "ordered", "ol"],
    icon: ListOrdered,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "Lista de tarefas",
    hint: HINTS.taskList,
    keywords: ["tarefa", "task", "todo", "checkbox", "checklist"],
    icon: ListChecks,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: "Citação",
    hint: HINTS.blockquote,
    keywords: ["citacao", "quote", "blockquote"],
    icon: Quote,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: "Bloco de código",
    hint: HINTS.codeBlock,
    keywords: ["codigo", "code", "pre", "snippet"],
    icon: SquareCode,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: "Linha divisória",
    keywords: ["linha", "divisoria", "hr", "regua", "separador"],
    icon: Minus,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: "Bloco recolhível",
    hint: HINTS.details,
    keywords: ["details", "toggle", "recolhivel", "acordeao", "spoiler"],
    icon: ListTree,
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setDetails().run(),
  },
];

function filterItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.keywords.some((word) => word.includes(q))
  );
}

type SlashSuggestion = Omit<SuggestionOptions<SlashItem, SlashItem>, "editor">;

const suggestion: SlashSuggestion = {
  char: "/",
  startOfLine: false,
  items: ({ query }) => filterItems(query),
  command: ({ editor, range, props }) => props.run(editor, range),
  render: () => {
    let component: ReactRenderer<SlashMenuHandle> | null = null;
    let unmount: (() => void) | null = null;

    return {
      onStart: (props) => {
        component = new ReactRenderer(SlashMenuList, {
          editor: props.editor,
          props: { items: props.items, command: props.command },
        });
        unmount = props.mount(component.element as HTMLElement);
      },
      onUpdate: (props) => {
        component?.updateProps({
          items: props.items,
          command: props.command,
        });
      },
      onKeyDown: (props) => {
        if (props.event.key === "Escape") {
          unmount?.();
          unmount = null;
          return true;
        }
        return component?.ref?.onKeyDown(props.event) ?? false;
      },
      onExit: () => {
        unmount?.();
        unmount = null;
        component?.destroy();
        component = null;
      },
    };
  },
};

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        ...suggestion,
      }),
    ];
  },
});
