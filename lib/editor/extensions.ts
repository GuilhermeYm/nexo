import { Extension, Node, type Extensions } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Typography } from "@tiptap/extension-typography";
import { Placeholder } from "@tiptap/extensions";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";

import { lowlight } from "@/lib/editor/lowlight";
import { SlashCommand } from "@/lib/editor/slash-command";
import { TextColor } from "@/lib/editor/text-color";

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
  /** O documento da Agenda: só listas de tarefas, a caixa não sai. */
  agenda?: boolean;
}

/**
 * O `doc` da Agenda aceita só `taskList`.
 *
 * A trava mora no schema e não em atalhos: Backspace, Enter numa caixa vazia,
 * colar, o bubble menu — todo caminho que tiraria a caixa vira uma transação
 * inválida, e o ProseMirror a recusa sozinho. Interceptar tecla por tecla
 * deixaria sempre um caminho esquecido.
 */
const AgendaDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "taskList+",
});

/**
 * Enter numa caixa vazia de primeiro nível não faz nada.
 *
 * Sem isto o schema já impede a caixa de sumir, mas o Enter cai no
 * `splitBlock` e abre um segundo parágrafo *dentro* do mesmo item — a linha
 * nova aparece sem caixa. Nos itens aninhados o comportamento de sempre
 * (recuar um nível) continua valendo, porque o pai ainda é uma lista.
 */
const AgendaEnter = Extension.create({
  name: "agendaEnter",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parent.content.size > 0) return false;
        const item = $from.node(-1);
        const topLevel = $from.depth === 3;
        return item?.type.name === "taskItem" && topLevel;
      },
    };
  },
});

/**
 * Backspace no começo de uma tarefa vazia remove o item e volta para a
 * anterior.
 *
 * A proteção do marcador `- [ ]` já é do schema (`AgendaDocument`, acima): uma
 * transação que tiraria a caixa e deixasse um parágrafo solto é inválida, e o
 * ProseMirror a recusa sozinho — nenhum JS precisa vigiar isso. O que falta é
 * só a segunda metade: com a caixa **já vazia**, o próximo Backspace apaga o
 * item inteiro (não só o texto, que já não existe) e leva o cursor para o
 * fim da tarefa anterior, em vez de travar numa lacuna entre as duas. A
 * única caixa de primeiro nível fica: a Agenda sempre precisa ter um lugar
 * onde escrever.
 */
/** Trata o Backspace antes do keymap padrão da lista poder transformar a caixa. */
export function handleAgendaTaskBackspace(view: EditorView) {
  const { selection } = view.state;
  const { $from } = selection;
  const selectedTask = selection instanceof NodeSelection && selection.node.type.name === "taskItem";
  const taskAtBoundary = $from.nodeAfter?.type.name === "taskItem";

  let taskItemPosition: number;
  let taskItem: typeof selection.$from.parent;
  let taskListDepth: number;

  if (selectedTask) {
    taskItemPosition = selection.from;
    taskItem = selection.node;
    taskListDepth = $from.depth;
  } else if (taskAtBoundary) {
    taskItemPosition = $from.pos;
    taskItem = $from.nodeAfter!;
    taskListDepth = $from.depth;
  } else {
    if (!selection.empty || $from.parentOffset !== 0) return false;

    let taskItemDepth = -1;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type.name === "taskItem") {
        taskItemDepth = depth;
        break;
      }
    }
    if (taskItemDepth === -1) return false;

    taskItem = $from.node(taskItemDepth);
    taskListDepth = taskItemDepth - 1;
    taskItemPosition = $from.before(taskItemDepth);
  }

  if (taskItem.textContent.length > 0) return false;

  const taskList = $from.node(taskListDepth);
  if (taskList.type.name !== "taskList") return false;

  // A lista de primeiro nível não pode ficar sem sua última caixa. Listas
  // aninhadas podem sumir por inteiro: o item pai continua íntegro.
  if (taskListDepth === 1 && taskList.childCount === 1) return true;

  const transaction = view.state.tr.delete(
    taskItemPosition,
    taskItemPosition + taskItem.nodeSize
  );
  const previousTask = TextSelection.near(
    transaction.doc.resolve(taskItemPosition),
    -1
  );

  view.dispatch(transaction.setSelection(previousTask).scrollIntoView());
  return true;
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
  agenda = false,
}: BuildOptions): Extensions {
  return [
    ...(agenda ? [AgendaDocument, AgendaEnter] : []),
    StarterKit.configure({
      document: agenda ? false : undefined,
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
    // Cor do texto por nome da paleta, não por valor — ver o arquivo.
    TextColor,
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
