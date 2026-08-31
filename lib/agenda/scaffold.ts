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
