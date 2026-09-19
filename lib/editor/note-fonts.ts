/**
 * As fontes que uma nota pode usar — a lista curada, sem nada de carregamento.
 *
 * Este arquivo é só dado: o Zod do `PATCH /api/notes/[id]` o importa no
 * servidor, e ali não pode entrar o `next/font`. O carregamento das fontes
 * mora em `components/editor/note-font-faces.ts`, só no cliente do editor.
 *
 * **Por que lista curada, e não qualquer fonte do Google Fonts nem upload.**
 * Carregar do Google em tempo de execução poria um terceiro em toda abertura
 * de nota (o IP da pessoa vai junto) e pediria abrir o CSP; upload pediria
 * storage, URL assinada dentro do `@font-face` e cuidado com licença. O
 * `next/font` baixa estas no build e as serve do próprio domínio — o CSP não
 * muda — e cada uma só desce para o navegador quando alguém a escolhe.
 *
 * Acrescentar uma fonte: um item aqui e o carregador em `note-font-faces.ts`.
 * O CHECK da drizzle/0033 só trava o formato do id, não a lista.
 */
export const NOTE_FONT_IDS = [
  "default",
  "literata",
  "lora",
  "atkinson",
  "nunito",
  "mono",
] as const;

export type NoteFontId = (typeof NOTE_FONT_IDS)[number];

export const NOTE_FONTS: {
  id: NoteFontId;
  name: string;
  /** Uma linha sobre quando escolher — o menu a mostra embaixo do nome. */
  hint: string;
}[] = [
  { id: "default", name: "Padrão", hint: "Geist, a fonte do Nexo" },
  { id: "literata", name: "Literata", hint: "Serifada, para leitura longa" },
  { id: "lora", name: "Lora", hint: "Serifada, mais caligráfica" },
  { id: "atkinson", name: "Atkinson", hint: "Feita para ler sem esforço" },
  { id: "nunito", name: "Nunito", hint: "Arredondada e leve" },
  { id: "mono", name: "Geist Mono", hint: "Monoespaçada, de máquina" },
];

/** Um id que saiu da lista (ou nunca esteve nela) volta a ser o padrão. */
export function resolveNoteFont(id: string | null | undefined): NoteFontId {
  return (NOTE_FONT_IDS as readonly string[]).includes(id ?? "")
    ? (id as NoteFontId)
    : "default";
}
