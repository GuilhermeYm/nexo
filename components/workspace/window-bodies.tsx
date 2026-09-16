"use client";

import { Plus, Sparkles, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { NOTE_TYPE_LABEL } from "@/components/dashboard/note-type-icon";
import { useBoardRichEditor } from "@/hooks/use-board-rich-editor";
import {
  TAG_DOT_CLASS,
  TAG_PALETTE,
  storedChipClass,
} from "@/lib/tags/palette";
import type { BoardNoteTag, BoardWindow } from "@/lib/workspace/queries";
import { cn } from "@/lib/utils";

/**
 * O miolo de cada tipo de janela.
 *
 * Três regras valem para os dois:
 *
 * 1. Nada aqui gerencia o próprio salvamento — o `useBoardWindows` recebe
 *    cada tecla e decide quando escrever.
 * 2. Os campos são controles nativos (`input`, `textarea`), nunca um `div`
 *    com `contentEditable` caseiro. A exceção é o corpo da nota **quando a
 *    preferência "Editor rico na lousa" está ligada** (Configurações →
 *    Preferências): aí ele vira o `NoteWindowEditor`, cujo `contentEditable`
 *    é o do TipTap/ProseMirror — seleção, desfazer, corretor, teclado de
 *    celular e leitor de tela vêm prontos —, carregado por `next/dynamic`.
 *    Desligada (o padrão), o corpo é um `textarea` como os outros.
 * 3. O foco é desenhado **por dentro** do campo, com `FIELD_FOCUS`. O anel
 *    padrão da aplicação é um `outline` com deslocamento de 2px: num campo
 *    que ocupa a largura inteira da janela, ele era desenhado para fora do
 *    campo, batia na moldura arredondada e virava um retângulo preto cortado
 *    em cima da borda. `data-focus-ring="container"` desliga aquele anel (é
 *    o escape que o `globals.css` já previa) e o `ring-inset` desenha o
 *    contorno para dentro, onde ele nunca encosta na borda da janela.
 */

/** Foco contido no próprio campo — ver a regra 3 acima. */
const FIELD_FOCUS =
  "rounded-lg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-subtle-foreground";

/**
 * O corpo da nota é o TipTap, carregado só quando uma janela de nota aparece
 * na lousa. Enquanto o chunk desce, o texto puro fica visível — não uma faixa
 * de "carregando".
 */
const NoteWindowEditor = dynamic(
  () =>
    import("@/components/workspace/note-window-editor").then(
      (m) => m.NoteWindowEditor
    ),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-0 flex-1 px-3.5 pb-2.5 text-sm text-subtle-foreground">
        Carregando o editor…
      </div>
    ),
  }
);

// As seis matizes de tag do tema, por posição.
// A borda puxa a matiz do próprio texto da tag. No tema claro as superfícies
// de tag são vizinhas do papel, e sem esse contorno o post-it não se separa
// do fundo — ele fica parecendo um retângulo sujo, não um objeto.
export const TONE_SURFACE: Record<string, string> = {
  "1": "border-tag-1-foreground/45 bg-tag-1",
  "2": "border-tag-2-foreground/45 bg-tag-2",
  "3": "border-tag-3-foreground/45 bg-tag-3",
  "4": "border-tag-4-foreground/45 bg-tag-4",
  "5": "border-tag-5-foreground/45 bg-tag-5",
  "6": "border-tag-6-foreground/45 bg-tag-6",
};

const TONE_DOT: Record<string, string> = {
  "1": "bg-tag-1-foreground",
  "2": "bg-tag-2-foreground",
  "3": "bg-tag-3-foreground",
  "4": "bg-tag-4-foreground",
  "5": "bg-tag-5-foreground",
  "6": "bg-tag-6-foreground",
};

export const TONES = ["1", "2", "3", "4", "5", "6"];

export const TEXT_TONE_CLASS: Record<string, string> = {
  default: "text-muted-foreground",
  "1": "text-tag-1-foreground",
  "2": "text-tag-2-foreground",
  "3": "text-tag-3-foreground",
  "4": "text-tag-4-foreground",
  "5": "text-tag-5-foreground",
  "6": "text-tag-6-foreground",
};

/* ---------------------------------------------------------------------- */

interface NoteBodyProps {
  window: BoardWindow;
  /** Foi criada agora: o título entra em edição sozinho. */
  autoFocus: boolean;
  onChange: (patch: {
    title?: string;
    content?: string;
    contentRich?: unknown;
  }) => void;
  /** Marca a nota com uma tag nova ou já existente, pelo nome. */
  onAddTag: (name: string) => void;
  /** Tira uma tag da nota. */
  onRemoveTag: (tagId: string) => void;
  /** Renomeia ou recolore a tag — em todas as notas que a usam. */
  onUpdateTag: (
    tagId: string,
    patch: { name?: string; color?: string | null }
  ) => void;
}

export function NoteWindowBody({
  window: item,
  autoFocus,
  onChange,
  onAddTag,
  onRemoveTag,
  onUpdateTag,
}: NoteBodyProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const note = item.note;
  const richEditor = useBoardRichEditor();

  useEffect(() => {
    if (!autoFocus) return;
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [autoFocus]);

  if (!note) {
    // O CHECK do banco garante que isto não acontece; a interface ainda
    // assim não some, porque uma janela em branco sem explicação é pior que
    // uma linha de texto dizendo o que houve.
    return (
      <p className="p-4 text-sm text-subtle-foreground">
        Esta janela perdeu a nota que mostrava.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3.5 pt-2">
        <span className="text-[10px] font-semibold tracking-wide text-subtle-foreground uppercase">
          {NOTE_TYPE_LABEL[note.type] ?? "Nota"}
        </span>
        {note.source === "ai" && (
          // Autoria da IA é sempre visível e nunca apagada — princípio nº 4.
          <span className="inline-flex items-center gap-1 rounded-full bg-tertiary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            <Sparkles className="size-2.5" aria-hidden="true" />
            IA
          </span>
        )}
      </div>

      <label className="sr-only" htmlFor={`title-${item.id}`}>
        Título da nota
      </label>
      <div className="px-2.5">
        <input
          id={`title-${item.id}`}
          ref={titleRef}
          value={note.title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="Sem título"
          maxLength={200}
          data-focus-ring="container"
          className={cn(
            "w-full bg-transparent px-1 pt-1 pb-2 text-base font-bold tracking-[-0.01em] text-foreground outline-none placeholder:text-subtle-foreground",
            FIELD_FOCUS
          )}
        />
      </div>

      <TagRow
        tags={note.tags}
        onAdd={onAddTag}
        onRemove={onRemoveTag}
        onUpdate={onUpdateTag}
      />

      {/* O corpo tem dois modos. Por padrão é um `textarea` leve; ligada a
          preferência "editor rico na lousa" (Configurações → Preferências),
          vira o mesmo TipTap da nota e do rascunho — sem barra fixa, só o
          bubble menu, carregado por `next/dynamic`. Em ambos, o texto puro
          alimenta a busca; no modo rico o servidor o deriva do documento a
          cada salvamento (ver `PATCH /api/notes/[id]`). */}
      {richEditor ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <NoteWindowEditor
            key={note.id}
            content={note.content}
            contentRich={note.contentRich}
            autoFocus={false}
            onChange={(patch) => onChange(patch)}
          />
        </div>
      ) : (
        <>
          <label className="sr-only" htmlFor={`content-${item.id}`}>
            Conteúdo da nota
          </label>
          <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-2.5">
            <textarea
              id={`content-${item.id}`}
              value={note.content ?? ""}
              onChange={(event) => onChange({ content: event.target.value })}
              placeholder="Escreva aqui. A Nexo guarda sozinha."
              data-focus-ring="container"
              className={cn(
                "min-h-0 w-full flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-relaxed text-muted-foreground outline-none placeholder:text-subtle-foreground",
                FIELD_FOCUS
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * As tags da nota, na janela da lousa — dá para marcar, desmarcar, renomear e
 * escolher a cor aqui, sem abrir o editor.
 *
 * O chip usa só a cor **gravada** (`storedChipClass`) — cinza quando não há.
 * A cor derivada do nome mora na página `/dashboard/tags`. O "×" some em
 * repouso (fica sempre visível no toque) para a linha não parecer um campo
 * cheio de botões. `stopPropagation` no `pointerdown` de tudo aqui: a barra
 * de título é área de arraste, e clicar num chip não pode começar a mover a
 * janela.
 *
 * **Editar é um clique no próprio chip.** Uma tag corrigida na hora em que se
 * escreve é uma tag que não fica errada; mandar a pessoa para uma tela de
 * administração no meio da nota é o que faz `a-classificar` sobreviver para
 * sempre. O painel que abre mexe na **tag**, não na marcação: o nome e a cor
 * valem em todas as notas que a usam, e ele diz isso em voz alta.
 */
function TagRow({
  tags,
  onAdd,
  onRemove,
  onUpdate,
}: {
  tags: BoardNoteTag[];
  onAdd: (name: string) => void;
  onRemove: (tagId: string) => void;
  onUpdate: (tagId: string, patch: { name?: string; color?: string | null }) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function commit() {
    const name = value.trim();
    if (name) onAdd(name);
    setValue("");
    setAdding(false);
  }

  const editing = tags.find((tag) => tag.id === editingId) ?? null;

  return (
    // `pt-2` e não zero: com o título em foco, o campo desenha um retângulo
    // arredondado em volta de si (`FIELD_FOCUS`), e a linha das tags encostava
    // nele — sobravam 4px. Aí é só o chip acender no hover para os dois se
    // lerem como uma coisa só, com a moldura do campo passando rente à
    // etiqueta. O espaço é o que diz que são dois controles.
    <div className="relative flex flex-wrap items-center gap-1 px-3.5 pt-2 pb-1.5">
      {tags.map((tag) => (
        <span key={tag.id}>
          <span
            className={cn(
              "group/tag inline-flex max-w-[11rem] items-center gap-0.5 rounded-full py-0.5 pr-1 pl-1.5 text-[10px] font-medium",
              storedChipClass(tag)
            )}
          >
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() =>
                setEditingId((current) => (current === tag.id ? null : tag.id))
              }
              aria-label={`Editar a tag ${tag.name}`}
              aria-expanded={editingId === tag.id}
              className="truncate"
            >
              #{tag.name}
            </button>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onRemove(tag.id)}
              aria-label={`Tirar a tag ${tag.name}`}
              className="grid size-3 shrink-0 place-items-center rounded-full opacity-0 transition-opacity duration-100 group-hover/tag:opacity-100 hover:bg-black/10 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100"
            >
              <X className="size-2.5" aria-hidden="true" />
            </button>
          </span>
        </span>
      ))}

      {/* Ancorado na linha, não no chip: um chip na ponta direita de uma
          janela estreita abriria o painel para fora da moldura, que é
          `overflow-hidden` — e metade dele sumiria. Preso à linha, ele nunca
          é mais largo que a janela. */}
      {editing && (
        <TagEditor
          key={editing.id}
          tag={editing}
          onClose={() => setEditingId(null)}
          onUpdate={(patch) => onUpdate(editing.id, patch)}
        />
      )}

      {adding ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              setValue("");
              setAdding(false);
            }
          }}
          onBlur={commit}
          placeholder="nova tag"
          maxLength={40}
          className="h-5 w-24 rounded-full border border-border bg-background px-2 text-[10px] text-foreground outline-none placeholder:text-subtle-foreground focus:border-subtle-foreground"
        />
      ) : (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border py-0.5 pr-1.5 pl-1 text-[10px] font-medium text-subtle-foreground transition-colors duration-100 hover:border-subtle-foreground hover:text-foreground motion-reduce:transition-none"
        >
          <Plus className="size-2.5" aria-hidden="true" />
          tag
        </button>
      )}
    </div>
  );
}

/**
 * O painel de uma tag: o nome e a cor.
 *
 * **A cor grava na hora; o nome espera o Enter.** Uma amostra de cor é um
 * gesto só e o resultado se vê imediatamente — pedir confirmação depois de
 * clicar num quadrado colorido é uma etapa que não explica nada. O nome é
 * digitado letra por letra, e gravar a cada tecla criaria uma dúzia de
 * renomeios auditados para uma correção só.
 *
 * **`onPointerDown` com `stopPropagation` em tudo.** O painel fica dentro da
 * janela, e a lousa lê `pointerdown` para começar gestos; sem isto, clicar
 * numa amostra arrastaria a janela junto.
 */
function TagEditor({
  tag,
  onClose,
  onUpdate,
}: {
  tag: BoardNoteTag;
  onClose: () => void;
  onUpdate: (patch: { name?: string; color?: string | null }) => void;
}) {
  const [draft, setDraft] = useState(tag.name);
  const boxRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Sem rolar a lousa para alcançar o campo — ver "A lousa deslocada" no
    // AGENTS: a moldura é recortada, e `focus()` pediria rolagem a um
    // ancestral que não deve rolar.
    nameRef.current?.focus({ preventScroll: true });
    nameRef.current?.select();

    function handleOutside(event: PointerEvent) {
      if (!boxRef.current?.contains(event.target as Node)) onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }

    // Na fase de captura: a janela e a lousa param a propagação dos próprios
    // gestos, e um ouvinte de borbulhamento nunca receberia o clique de fora.
    document.addEventListener("pointerdown", handleOutside, true);
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutside, true);
      document.removeEventListener("keydown", handleKey, true);
    };
  }, [onClose]);

  function commitName() {
    const name = draft.trim();
    if (name && name.toLowerCase() !== tag.name) onUpdate({ name });
  }

  return (
    <div
      ref={boxRef}
      onPointerDown={(event) => event.stopPropagation()}
      className="absolute top-full right-3.5 left-3.5 z-20 mt-1 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
    >
      {/* O campo é a **primeira faixa do painel**, não uma caixa dentro dele.
          Uma moldura a 2px de distância de outra moldura lê como erro de
          desenho, e com o campo em foco (ele abre focado) as duas ficavam
          desenhadas ao mesmo tempo. O que separa o nome das cores é a linha
          divisória abaixo — que já precisava existir de qualquer forma.

          O "#" à esquerda faz o trabalho que a borda fazia: sem ele, um campo
          sem moldura no topo de um painel pode ser lido como título.

          O foco acende a **faixa**, não o campo — o mesmo desenho da barra de
          comando do dashboard, e o motivo do `data-focus-ring="container"`
          abaixo: `outline-none` do Tailwind não vence o anel global do
          `globals.css`, que é quem estava desenhando o retângulo escuro. */}
      <div className="flex items-center px-2.5 pt-2 pb-1.5 transition-colors duration-150 has-[:focus-visible]:bg-secondary/60 motion-reduce:transition-none">
        <span aria-hidden="true" className="text-xs text-subtle-foreground">
          #
        </span>
        <input
          aria-label="Nome da tag"
          ref={nameRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitName();
              onClose();
            }
          }}
          onBlur={commitName}
          maxLength={40}
          data-focus-ring="container"
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-foreground outline-none placeholder:text-subtle-foreground"
        />
      </div>

      <div className="border-t border-border px-2.5 py-2">
        <div
          role="group"
          aria-label="Cor da tag"
          className="flex items-center gap-1"
        >
          {TAG_PALETTE.map((position) => (
            <button
              key={position}
              type="button"
              aria-label={`Cor ${position}`}
              aria-pressed={tag.color === position}
              onClick={() => onUpdate({ color: position })}
              className={cn(
                "size-5 rounded-full border transition-transform duration-150 pointer-coarse:size-7 motion-reduce:transition-none",
                TAG_DOT_CLASS[position],
                tag.color === position
                  ? "scale-110 border-foreground"
                  : "border-transparent hover:scale-110"
              )}
            />
          ))}
          {/* Tirar a cor é uma escolha, não a ausência de uma: sem este botão
              a única forma de voltar ao cinza seria apagar a tag e criar de
              novo. */}
          <button
            type="button"
            aria-label="Sem cor"
            aria-pressed={!tag.color}
            onClick={() => onUpdate({ color: null })}
            className={cn(
              "grid size-5 place-items-center rounded-full border bg-secondary text-muted-foreground transition-transform duration-150 pointer-coarse:size-7 motion-reduce:transition-none",
              tag.color
                ? "border-transparent hover:scale-110"
                : "scale-110 border-foreground"
            )}
          >
            <X className="size-2.5" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-2 text-[10px] leading-snug text-subtle-foreground">
          O nome e a cor valem em todas as notas com esta tag.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

interface ElementBodyProps {
  window: BoardWindow;
  autoFocus: boolean;
  onChange: (patch: { text?: string; tone?: string }) => void;
  onCommit: (patch: { text?: string; tone?: string }) => void;
}

/**
 * Post-it e caixa de texto.
 *
 * A diferença é só de material: o post-it tem superfície colorida e a caixa
 * de texto tem fundo translúcido, mais leve que uma nota. Os dois guardam o
 * texto na própria janela — não viram nota, e por isso a busca não os
 * alcança. É a troca que o formato pede, e ela fica dita na interface pelo
 * rótulo do menu de criação ("fica só nesta lousa").
 */
export function ElementWindowBody({
  window: item,
  autoFocus,
  onChange,
  onCommit,
}: ElementBodyProps) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const isSticky = item.kind === "sticky";
  const tone = item.content?.tone ?? "1";
  const textTone = item.content?.textTone ?? "default";

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="flex h-full flex-col">
      <label className="sr-only" htmlFor={`text-${item.id}`}>
        {isSticky ? "Texto do post-it" : "Texto"}
      </label>
      <div className="flex min-h-0 flex-1 flex-col p-2.5">
        <textarea
          id={`text-${item.id}`}
          ref={textRef}
          value={item.content?.text ?? ""}
          onChange={(event) => onChange({ text: event.target.value })}
          placeholder={isSticky ? "Anote aqui…" : "Escreva…"}
          data-focus-ring="container"
          className={cn(
            "min-h-0 w-full flex-1 resize-none bg-transparent px-1 py-0.5 outline-none placeholder:text-subtle-foreground",
            FIELD_FOCUS,
            isSticky
              ? "text-sm leading-relaxed font-medium text-foreground"
              : cn(
                  "text-sm leading-relaxed",
                  TEXT_TONE_CLASS[textTone] ?? TEXT_TONE_CLASS.default
                )
          )}
        />
      </div>

      {isSticky && (
        <div
          role="group"
          aria-label="Cor do post-it"
          className="flex shrink-0 items-center gap-1 px-3 pb-2.5 opacity-0 transition-opacity duration-150 group-hover/window:opacity-100 group-focus-within/window:opacity-100 motion-reduce:transition-none"
        >
          {TONES.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`Cor ${value}`}
              aria-pressed={value === tone}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onCommit({ tone: value })}
              className={cn(
                "size-4 rounded-full border transition-transform duration-150 pointer-coarse:size-6 motion-reduce:transition-none",
                TONE_DOT[value],
                value === tone
                  ? "scale-110 border-foreground"
                  : "border-transparent hover:scale-110"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
