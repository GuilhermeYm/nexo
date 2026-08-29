"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

import { NOTE_TYPE_LABEL } from "@/components/dashboard/note-type-icon";
import type { BoardWindow } from "@/lib/workspace/queries";
import { cn } from "@/lib/utils";

/**
 * O miolo de cada tipo de janela.
 *
 * Três regras valem para os dois:
 *
 * 1. Nada aqui gerencia o próprio salvamento — o `useBoardWindows` recebe
 *    cada tecla e decide quando escrever.
 * 2. O campo é sempre um controle nativo (`input`, `textarea`), nunca um
 *    `div` com `contentEditable`. Um `textarea` traz de graça o que um
 *    editor caseiro leva meses para reconstruir: seleção, desfazer, corretor
 *    ortográfico, teclado de celular e leitor de tela.
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

/* ---------------------------------------------------------------------- */

interface NoteBodyProps {
  window: BoardWindow;
  /** Foi criada agora: o título entra em edição sozinho. */
  autoFocus: boolean;
  onChange: (patch: { title?: string; content?: string }) => void;
}

export function NoteWindowBody({ window: item, autoFocus, onChange }: NoteBodyProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const note = item.note;

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
              : "text-sm leading-relaxed text-muted-foreground"
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
