import { z } from "zod";

/**
 * A ponte entre o documento do editor e o texto puro.
 *
 * `notes.content_rich` guarda a estrutura; `notes.content` guarda o texto, e
 * é ele que alimenta o `search_vector` e os resumos. Quem mantém os dois em
 * sincronia é o **servidor**, derivando um do outro a cada salvamento — se
 * isso ficasse a cargo do cliente, bastaria uma requisição forjada para a
 * busca passar a indexar qualquer coisa.
 */

interface RichNode {
  type?: string;
  text?: string;
  content?: unknown[];
  /** Só `taskItem.checked` é lido daqui — ver `countTaskItems`. */
  attrs?: { checked?: unknown };
}

/**
 * Nós cujo fim vira quebra de linha no texto puro.
 *
 * A lista é de tipos de bloco do ProseMirror. Um tipo desconhecido não quebra
 * nada: ele só não separa, e o texto sai concatenado — degradação silenciosa
 * é melhor aqui do que perder o conteúdo por não reconhecer uma extensão.
 */
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "listItem",
  "taskItem",
  "detailsSummary",
  "detailsContent",
  "horizontalRule",
  "tableRow",
]);

/**
 * Tetos de segurança.
 *
 * O documento chega do cliente. Um JSON com dez mil níveis de aninhamento
 * derrubaria uma travessia recursiva com estouro de pilha — por isso a
 * travessia abaixo é iterativa — e um documento gigante seguraria a rota.
 * Estes números são altos o bastante para qualquer nota real.
 */
const MAX_NODES = 50_000;
const MAX_CHARS = 200_000;
const MAX_DOCUMENT_BYTES = 1_000_000;

/** Marcador de "terminei os filhos deste bloco" na pilha da travessia. */
const CLOSE_BLOCK = Symbol("close");

/**
 * Extrai o texto puro de um documento do editor.
 *
 * Iterativa de propósito: ver `MAX_NODES` acima.
 */
export function richTextToPlain(document: unknown): string {
  if (!isRichNode(document)) return "";

  const parts: string[] = [];
  const stack: (RichNode | typeof CLOSE_BLOCK)[] = [document];
  let visited = 0;
  let length = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (current === CLOSE_BLOCK) {
      parts.push("\n");
      length += 1;
      continue;
    }

    if (++visited > MAX_NODES || length > MAX_CHARS) break;

    if (typeof current.text === "string") {
      parts.push(current.text);
      length += current.text.length;
      continue;
    }

    if (current.type === "hardBreak") {
      parts.push("\n");
      length += 1;
      continue;
    }

    const children = Array.isArray(current.content) ? current.content : [];

    // A pilha devolve o último empilhado primeiro: o fechamento vai antes
    // dos filhos, e os filhos entram invertidos para saírem na ordem certa.
    if (BLOCK_TYPES.has(current.type ?? "")) stack.push(CLOSE_BLOCK);
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      if (isRichNode(child)) stack.push(child);
    }
  }

  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CHARS);
}

export interface TaskTally {
  /** Quantos `taskItem` o documento tem, incluindo os aninhados. */
  total: number;
  /** Quantos deles estão com `attrs.checked === true`. */
  done: number;
}

/**
 * Conta as caixas de um documento.
 *
 * O irmão de `richTextToPlain`: a mesma travessia iterativa, o mesmo teto de
 * nós, o mesmo contrato — **o servidor deriva, o cliente nunca informa**. É o
 * que permite a Agenda listar trinta dias com "5 de 7" sem baixar o
 * `content_rich` de nenhum deles.
 *
 * Não tem sentinela de fechamento (`CLOSE_BLOCK`) porque não há texto para
 * montar: só nós para visitar.
 *
 * Fica separada de `richTextToPlain`, e não fundida numa travessia só, por
 * três razões. A primeira é que esta função é pura e não leva `server-only`,
 * então **a interface usa a mesma implementação no cliente** para repintar o
 * contador no instante em que a caixa é marcada — o servidor grava o número
 * autoritativo, e os dois lados saem do mesmo código. A segunda é que fundir
 * exigiria interleavar um contador dentro do laço da sentinela, a parte mais
 * sutil da função de que a busca inteira depende. A terceira é que duas
 * projeções com consumidores diferentes não deveriam compartilhar tipo de
 * retorno: no dia em que o tally crescer, ele arrastaria a busca junto.
 *
 * Se `MAX_NODES` cortar a travessia, a contagem é a de um prefixo — o mesmo
 * acordo que `richTextToPlain` já faz com `MAX_CHARS`.
 */
export function countTaskItems(document: unknown): TaskTally {
  if (!isRichNode(document)) return { total: 0, done: 0 };

  const stack: RichNode[] = [document];
  let visited = 0;
  let total = 0;
  let done = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (++visited > MAX_NODES) break;

    if (current.type === "taskItem") {
      total += 1;
      // `=== true`, não coerção: o documento vem do cliente e
      // `richDocumentSchema` é `looseObject` de propósito. Um `checked: "não"`
      // forjado é uma tarefa pendente, não uma concluída — e a coerção diria
      // o contrário, porque toda string não vazia é verdadeira.
      if (current.attrs?.checked === true) done += 1;
    }

    const children = Array.isArray(current.content) ? current.content : [];
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      if (isRichNode(child)) stack.push(child);
    }
  }

  return { total, done };
}

export interface TaskLine {
  text: string;
  checked: boolean;
  /** 0 no primeiro nível; aninhadas sobem de um em um. */
  depth: number;
}

/**
 * As caixas de um documento, na ordem em que aparecem, com o texto da linha.
 *
 * O texto é só o do primeiro parágrafo do item — o que fica ao lado da caixa.
 * Caixas sem texto ficam de fora: é o andaime vazio, não uma tarefa.
 */
export function listTaskLines(document: unknown): TaskLine[] {
  if (!isRichNode(document)) return [];

  const lines: TaskLine[] = [];
  const stack: { node: RichNode; depth: number }[] = [{ node: document, depth: -1 }];
  let visited = 0;

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (++visited > MAX_NODES) break;

    const children = (Array.isArray(node.content) ? node.content : []).filter(
      isRichNode
    );
    let childDepth = depth;

    if (node.type === "taskItem") {
      childDepth = depth + 1;
      const first = children[0];
      const text = first?.type === "paragraph" ? inlineText(first).trim() : "";
      if (text) {
        lines.push({ text, checked: node.attrs?.checked === true, depth: childDepth });
      }
    }

    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({ node: children[index], depth: childDepth });
    }
  }

  return lines;
}

function inlineText(node: RichNode): string {
  const children = Array.isArray(node.content) ? node.content : [];
  return children
    .map((child) =>
      isRichNode(child) && typeof child.text === "string" ? child.text : ""
    )
    .join("");
}

/**
 * Monta um documento a partir de texto puro.
 *
 * É o caminho de entrada das notas que existem desde antes do editor e das
 * que a IA escreveu: elas têm `content_rich` nulo, e o editor precisa de algo
 * para abrir. Uma linha vira um parágrafo; linha vazia vira parágrafo vazio,
 * porque um nó de texto com string vazia é inválido no ProseMirror.
 */
export function plainToRichDocument(text: string | null | undefined) {
  const lines = (text ?? "").split("\n");

  return {
    type: "doc",
    content:
      lines.length === 0
        ? [{ type: "paragraph" }]
        : lines.map((line) =>
            line.trim()
              ? { type: "paragraph", content: [{ type: "text", text: line }] }
              : { type: "paragraph" }
          ),
  };
}

/**
 * Valida o documento que chega do cliente.
 *
 * Não valida o schema do ProseMirror inteiro — isso duplicaria a definição
 * das extensões e quebraria a cada uma que fosse adicionada. Confere o que
 * importa para o servidor: é um documento, e cabe. A estrutura de dentro é
 * problema do editor, e um documento malformado só faz o próprio editor
 * mostrar menos — não alcança o banco de ninguém.
 */
export const richDocumentSchema = z
  .looseObject({ type: z.literal("doc") })
  .refine(
    (value) => JSON.stringify(value).length <= MAX_DOCUMENT_BYTES,
    { message: "Documento grande demais." }
  );

function isRichNode(value: unknown): value is RichNode {
  return typeof value === "object" && value !== null;
}
