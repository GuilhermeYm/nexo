import type { JSONContent } from "@tiptap/core";

/**
 * O documento com que um dia em branco da Agenda nasce.
 *
 * Sem ele o editor abriria num parágrafo, e a pessoa teria de saber que
 * `[] ` ou `Ctrl+Shift+9` viram caixa. A sala existe para tarefas: a primeira
 * coisa na tela tem de ser uma caixa esperando. É o mesmo princípio de "os
 * estados vazios têm CTA de verdade", aplicado a um documento.
 *
 * Isto **não** conta como conteúdo. O teste de "a pessoa escreveu alguma
 * coisa?" é `richTextToPlain(doc).trim().length > 0`, a mesma função e a
 * mesma regra que `POST /api/notes` já aplica — é o que faz um dia aberto e
 * não usado não gastar captura nenhuma.
 */
export const EMPTY_AGENDA_DOCUMENT = {
  type: "doc",
  content: [
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph" }],
        },
      ],
    },
  ],
} as const;

interface BlockNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: unknown[];
}

/**
 * Traz um documento para o formato da Agenda: só `taskList` no primeiro nível.
 *
 * O editor da Agenda recusa qualquer outra coisa ali (é o que impede a caixa
 * de sair), mas a mesma nota abre em `/nota/[id]` e na lousa, onde parágrafo
 * é permitido — e as listas gravadas antes da trava têm parágrafos soltos.
 * Cada bloco solto vira uma caixa, e listas vizinhas se fundem numa só.
 * Nada é descartado.
 */
export function toAgendaDocument(document: unknown): JSONContent {
  const blocks = Array.isArray((document as BlockNode | null)?.content)
    ? ((document as BlockNode).content as BlockNode[])
    : [];

  const items: BlockNode[] = [];
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    if (block.type === "taskList") {
      items.push(...((block.content ?? []) as BlockNode[]));
    } else if (block.type === "paragraph" || block.type === "heading") {
      items.push(asTaskItem([{ type: "paragraph", content: block.content }]));
    } else {
      // Um `taskItem` precisa começar por parágrafo; o bloco vai logo abaixo.
      items.push(asTaskItem([{ type: "paragraph" }, block]));
    }
  }

  if (items.length === 0) items.push(asTaskItem([{ type: "paragraph" }]));
  return {
    type: "doc",
    content: [{ type: "taskList", content: items as JSONContent[] }],
  };
}

function asTaskItem(content: BlockNode[]): BlockNode {
  return {
    type: "taskItem",
    attrs: { checked: false },
    content: content.map((node) =>
      node.content === undefined ? { type: node.type } : node
    ),
  };
}
