/**
 * A tipografia do documento do editor, num lugar só.
 *
 * O TipTap gera o HTML do conteúdo pelo ProseMirror — ele não passa pelas
 * nossas classes um a um —, então o estilo entra por descendência, com
 * variantes de arbitrary selector do Tailwind (`[&_h1]:…`). Duas telas usam
 * o mesmo editor: a nota em `/nota/[id]` e o rascunho do dashboard. Manter a
 * lista aqui evita que as duas divirjam.
 *
 * **O que NÃO está aqui:** a altura mínima (`min-h`) e a margem de topo. Elas
 * são de layout — a nota quer meia tela de área de escrita, o rascunho quer
 * uns centímetros dentro de um cartão — e cada chamador acrescenta a sua.
 */
export const PROSE_EDITOR_CLASS = [
  "[&_.tiptap]:text-[15px] [&_.tiptap]:leading-[1.75] [&_.tiptap]:text-muted-foreground",
  "[&_h1]:mt-8 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-[-0.01em] [&_h1]:text-foreground [&_h1]:font-[family-name:var(--font-display)]",
  "[&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-foreground [&_h2]:font-[family-name:var(--font-display)]",
  "[&_h3]:mt-6 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-foreground",
  "[&_p]:my-3",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
  "[&_blockquote]:my-4 [&_blockquote]:border-l [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-foreground [&_blockquote]:italic",
  "[&_code]:rounded [&_code]:bg-tertiary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-foreground",
  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-secondary [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[13px]",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_hr]:my-8 [&_hr]:border-border",
  "[&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4",
  "[&_mark]:rounded-[3px] [&_mark]:bg-highlight [&_mark]:px-0.5 [&_mark]:py-px [&_mark]:text-highlight-foreground [&_mark]:decoration-clone",
  // Task list: a marca some, cada item vira caixa + texto lado a lado. O
  // resto (cor do checkbox, texto riscado quando marcado) fica no globals.css,
  // que alcança os atributos `data-*` que o TipTap põe.
  "[&_ul[data-type=taskList]]:my-3 [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-1",
  "[&_ul[data-type=taskList]_li]:my-1 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-start [&_ul[data-type=taskList]_li]:gap-2",
  // Altura de `label` igual à altura de uma linha (`1.75em`, o mesmo
  // `leading-[1.75]` do parágrafo) e `items-center` por dentro: a caixa fica
  // no meio da primeira linha, não no topo do item. `mt-*` fixo (a versão
  // anterior) era um chute que só acertava num tamanho de fonte.
  "[&_ul[data-type=taskList]_li>label]:flex [&_ul[data-type=taskList]_li>label]:h-[1.75em] [&_ul[data-type=taskList]_li>label]:items-center [&_ul[data-type=taskList]_li>label]:shrink-0 [&_ul[data-type=taskList]_li>label]:select-none",
  // `flex-1` não é enfeite: sem ele o `div` de conteúdo encolhe até a largura
  // do texto, e num item **vazio** isso é zero. A linha inteira fica clicável
  // por fora da área editável, e o ProseMirror resolve o clique ora dentro do
  // item, ora no gap cursor depois do `<ul>` — quem digita ganha um parágrafo
  // em vez de uma tarefa, de forma intermitente. Com `flex-1` a área de texto
  // ocupa a linha toda e o clique sempre cai onde parece que cai.
  "[&_ul[data-type=taskList]_li>div]:min-w-0 [&_ul[data-type=taskList]_li>div]:flex-1 [&_ul[data-type=taskList]_li>div>p]:my-0",
  // O bloco recolhível (`[data-type=details]`) é estilizado inteiro no
  // globals.css — a extensão não usa `<details>` nativo e a marcação tem
  // partes que não cabem bem em arbitrary variant.
  // O placeholder do TipTap é um pseudo-elemento no primeiro parágrafo vazio.
  "[&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-subtle-foreground [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
].join(" ");
