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
