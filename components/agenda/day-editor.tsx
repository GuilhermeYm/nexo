"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { EditorBubbleMenu } from "@/components/editor/editor-bubble-menu";
import { ErrorReport } from "@/components/errors/error-report";
import { UpgradeLink } from "@/components/ui/upgrade-link";
import { toAgendaDocument } from "@/lib/agenda/scaffold";
import { countTaskItems, richTextToPlain } from "@/lib/editor/document";
import {
  buildEditorExtensions,
  handleAgendaTaskBackspace,
} from "@/lib/editor/extensions";
import { PROSE_EDITOR_CLASS } from "@/lib/editor/prose-classes";
import { readApiFailure, type ApiFailure } from "@/lib/plan-limit";
import { cn } from "@/lib/utils";

/**
 * O editor de um dia da Agenda.
 *
 * O mesmo TipTap da nota e do rascunho — mesmas extensões, mesma tipografia —
 * com duas diferenças que são a funcionalidade:
 *
 * 1. **O documento nasce com uma caixa**, não com um parágrafo
 *    (`EMPTY_AGENDA_DOCUMENT`), e **só aceita caixas no primeiro nível**
 *    (`agenda: true` em `buildEditorExtensions`): a caixa não pode ser
 *    apagada nem virar parágrafo.
 *
 * 2. **A nota é criada preguiçosamente.** Enquanto a pessoa não escreve nada,
 *    não existe linha no banco e nenhuma captura foi gasta. Na primeira tecla
 *    com conteúdo sai um PUT; da resposta em diante tudo vira
 *    `PATCH /api/notes/[id]`, com o debounce de sempre.
 *
 * Entra por `next/dynamic` (`ssr: false`) na sala, e isso é duplamente
 * motivado: o ProseMirror é a peça mais pesada do cliente, **e** a fronteira
 * de cliente é o que faz o problema de hidratação do dia local desaparecer —
 * o servidor nunca renderiza nada derivado do relógio do aparelho.
 */

const SAVE_DELAY = 900;

type SaveState = "idle" | "saving" | "saved" | "error";

interface DayEditorProps {
  /** `YYYY-MM-DD`. O dia que este editor edita. */
  date: string;
  /** O id da nota, quando o dia já existe. Nulo dispara a criação preguiçosa. */
  noteId: string | null;
  /** O documento guardado, ou nulo num dia que ainda não existe. */
  initialDoc: unknown | null;
  /** Avisa a sala que os contadores mudaram, para o "5 de 7" repintar na hora. */
  onTally?: (tally: { total: number; done: number }) => void;
  /** Avisa a sala que a nota passou a existir, e com que id. */
  onCreated?: (noteId: string) => void;
  /** Foco ao montar. O cartão de hoje usa; os dias antigos, não. */
  autoFocus?: boolean;
  className?: string;
}

export function DayEditor({
  date,
  noteId,
  initialDoc,
  onTally,
  onCreated,
  autoFocus = false,
  className,
}: DayEditorProps) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  /** O id de verdade. Começa no da prop e é preenchido pela criação. */
  const id = useRef<string | null>(noteId);
  /** O patch que ainda não foi. Acumula, em vez de enfileirar requisições. */
  const queued = useRef<{ contentRich?: unknown }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * O PUT em voo. Duas teclas rápidas antes da primeira resposta esperam a
   * mesma promessa, em vez de disparar dois PUT — mesmo padrão do
   * `connecting` das ligações da lousa. A rota é idempotente de qualquer
   * jeito: as duas travas, de novo.
   */
  const creating = useRef<Promise<string | null> | null>(null);
  /**
   * Recusa por teto trava novas tentativas até a pessoa pedir de novo. Sem
   * isso cada tecla dispararia um PUT e o convite piscaria.
   */
  const blocked = useRef(false);

  useEffect(() => {
    id.current = noteId;
  }, [noteId]);

  /** Cria a nota do dia. Devolve o id, ou nulo se não deu. */
  const create = useCallback(
    async (doc: unknown): Promise<string | null> => {
      const response = await fetch(`/api/agenda/${date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentRich: doc }),
      });

      if (!response.ok) {
        const parsed = await readApiFailure(
          response,
          "Não foi possível abrir o dia."
        );
        // Recusa por teto não é erro: o texto continua na tela, sem vermelho,
        // e o convite aparece ao lado. Ver docs/PLANOS.md.
        if (parsed.upgrade) blocked.current = true;
        setFailure(parsed);
        return null;
      }

      const body: unknown = await response.json().catch(() => null);
      const created = (body as { note?: { id?: string } } | null)?.note?.id;
      return typeof created === "string" ? created : null;
    },
    [date]
  );

  const flush = useCallback(
    async (keepalive = false) => {
      const patch = queued.current;
      queued.current = {};
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (Object.keys(patch).length === 0) return;
      if (blocked.current) return;

      setSaveState("saving");

      try {
        // Ainda não existe nota: este salvamento é a criação.
        if (!id.current) {
          const doc = patch.contentRich;
          // O andaime vazio não é conteúdo — mesma regra de `POST /api/notes`.
          if (richTextToPlain(doc).trim().length === 0) {
            setSaveState("idle");
            return;
          }
          if (!creating.current) creating.current = create(doc);
          const newId = await creating.current;
          creating.current = null;
          if (!newId) {
            setSaveState("error");
            return;
          }
          id.current = newId;
          onCreated?.(newId);
          setSaveState("saved");
          return;
        }

        const response = await fetch(`/api/notes/${id.current}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
          // Sair da página com tecla na fila é onde o texto mais se perde.
          keepalive,
        });
        if (!response.ok) {
          setFailure(await readApiFailure(response, "Não foi possível salvar."));
        }
        setSaveState(response.ok ? "saved" : "error");
      } catch {
        setSaveState("error");
      }
    },
    [create, onCreated]
  );

  const queue = useCallback(
    (patch: { contentRich?: unknown }) => {
      queued.current = { ...queued.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY);
    },
    [flush]
  );

  const editor = useEditor({
    // Obrigatório no App Router: renderizar já no servidor produz HTML que
    // não bate com o do cliente e a hidratação quebra.
    immediatelyRender: false,
    extensions: buildEditorExtensions({
      placeholder: "O que precisa acontecer?",
      // Sem "/": quase tudo no menu (título, citação, listas) é bloco de
      // primeiro nível, e o documento da Agenda só aceita caixas ali. Um
      // menu cheio de itens que não fazem nada é pior que menu nenhum.
      slash: false,
      agenda: true,
    }),
    content: toAgendaDocument(initialDoc),
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        // Alvo dos roteiros de ponta a ponta.
        id: `agenda-${date}`,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Tarefas do dia",
        class: "outline-none",
        "data-focus-ring": "container",
      },
    },
    onUpdate: ({ editor: current }) => {
      const doc = current.getJSON();
      // O contador repinta na hora, do mesmo código que o servidor usa para
      // gravar o número autoritativo — ver `countTaskItems`.
      onTally?.(countTaskItems(doc));
      queue({ contentRich: doc });
    },
  });

  // O keymap do TipTap também escuta Backspace no próprio contenteditable.
  // Capturar no EditorView garante que a segunda intenção seja decidida antes
  // de ele transformar a seleção da caixa vazia.
  useEffect(() => {
    if (!editor) return;
    const view = editor.view;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Backspace") return;
      if (!handleAgendaTaskBackspace(view)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    const dom = view.dom;
    dom.addEventListener("keydown", onKeyDown, true);
    return () => dom.removeEventListener("keydown", onKeyDown, true);
  }, [editor]);

  // Descarregar a fila ao sair da página ou trocar de aba.
  useEffect(() => {
    function onHide() {
      void flush(true);
    }
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      void flush(true);
    };
  }, [flush]);

  return (
    <div className={cn("flex flex-col", className)}>
      {/* Sem barra fixa, como o rascunho: o gesto dominante aqui é escrever
          uma linha, Enter, marcar a caixa. A formatação vem do bubble menu,
          do "/" e dos atalhos. */}
      <EditorBubbleMenu editor={editor} compact />
      {/*
        A altura mínima mora aqui, e não no `.tiptap`, por causa de um defeito
        concreto: com uma lista de um item só, o resto do cartão é área morta
        dentro do ProseMirror, e um clique ali cai no **gap cursor** depois do
        `<ul>`. O que a pessoa digitasse viraria parágrafo — numa sala de
        tarefas, o texto sai sem caixa e ela não entende por quê.

        Com a folga do lado de fora, o clique no vazio é nosso, e a resposta é
        levar o cursor para o fim do documento: `focus("end")` resolve para a
        posição de texto mais profunda, ou seja, **dentro** do último item da
        lista.
      */}
      <div
        className="min-h-[6rem] cursor-text"
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          editor?.commands.focus("end");
        }}
      >
        <EditorContent editor={editor} className={PROSE_EDITOR_CLASS} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <SaveIndicator state={saveState} />
        {failure && (
          <AgendaFailure
            failure={failure}
            onRetry={() => {
              blocked.current = false;
              setFailure(null);
              if (editor) queue({ contentRich: editor.getJSON() });
            }}
          />
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const text = {
    idle: "",
    saving: "Salvando…",
    saved: "Salvo",
    error: "Não salvou",
  }[state];

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "text-xs tabular-nums",
        state === "error" ? "text-error" : "text-subtle-foreground"
      )}
    >
      {text}
    </span>
  );
}

/**
 * O aviso do editor.
 *
 * Recusa por teto sai **sem vermelho** e com o convite ao lado; qualquer
 * outra falha leva o "tentar de novo". Ver docs/PLANOS.md.
 */
function AgendaFailure({
  failure,
  onRetry,
}: {
  failure: ApiFailure;
  onRetry: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs",
        failure.upgrade ? "text-muted-foreground" : "text-error"
      )}
      role="alert"
    >
      <span>{failure.message}</span>
      {failure.upgrade ? (
        <UpgradeLink />
      ) : (
        <button
          type="button"
          onClick={onRetry}
          className="font-medium underline decoration-border underline-offset-4"
        >
          Tentar de novo
        </button>
      )}
      {/* Só há código quando houve defeito de verdade — ver docs/ERRORS.md. */}
      {failure.code && (
        <ErrorReport code={failure.code} route="/api/agenda" compact />
      )}
    </div>
  );
}
