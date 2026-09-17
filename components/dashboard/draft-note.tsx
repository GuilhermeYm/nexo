"use client";

import { LoaderCircle, Maximize2, Minimize2, PenLine, Trash2, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { UpgradeLink } from "@/components/ui/upgrade-link";
import { useHideDraft } from "@/hooks/use-hide-draft";
import { useLocalDraft } from "@/hooks/use-local-draft";
import { richTextToPlain } from "@/lib/editor/document";
import { readApiFailure } from "@/lib/plan-limit";
import { cn } from "@/lib/utils";

/**
 * O editor entra por `next/dynamic`: o ProseMirror é a peça mais pesada do
 * cliente, e quem abre o dashboard só para capturar não deve baixá-lo até
 * abrir o rascunho de fato. Até o chunk chegar, uma faixa reservada segura a
 * altura para o cartão não saltar.
 */
const DraftEditor = dynamic(
  () => import("@/components/dashboard/draft-editor").then((m) => m.DraftEditor),
  {
    ssr: false,
    loading: () => (
      <div className="mt-1 border-t border-border px-2.5 pt-3 pb-4">
        <p className="text-sm text-subtle-foreground">Carregando o editor…</p>
      </div>
    ),
  }
);

/**
 * O rascunho do dashboard.
 *
 * **Por que ele não grava sozinho.** Tudo o mais na Nexo grava — é a
 * promessa do produto. Este é o momento anterior a ela: a ideia meio
 * formada, o número ditado ao telefone, o parágrafo que talvez não mereça
 * existir. Guardar isso automaticamente encheria a busca de fragmentos que
 * ninguém pediu para guardar, e a busca é o principal mecanismo de
 * descoberta do produto — sujá-la custa caro.
 *
 * Ele fica no navegador (ver `useLocalDraft`), e a interface diz isso em voz
 * alta em vez de deixar a pessoa descobrir depois. Um botão só o promove a
 * nota de verdade, com busca, tags e sincronização.
 *
 * Um elemento, dois estados: fechado é o convite; aberto é o papel. Havendo
 * rascunho guardado, ele abre sozinho — texto não salvo não pode ficar
 * escondido atrás de um clique.
 */

interface DraftNoteProps {
  /** O shell mostra o aviso e revalida os painéis. */
  onSaved: (title: string) => void;
  /** Entrega ao shell uma função que abre o rascunho — o estado vazio de
   *  Recentes a chama para o "Escrever uma nota" funcionar de lá. */
  registerOpen?: (open: () => void) => void;
}

export function DraftNote({ onSaved, registerOpen }: DraftNoteProps) {
  const { draft, update, discard } = useLocalDraft();
  const hideDraft = useHideDraft();
  const [opened, setOpened] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  // Quando o rascunho é aberto de longe (do painel de Recentes), ele rola
  // até a vista no render seguinte — o convite veio de baixo da dobra.
  const rootRef = useRef<HTMLElement | null>(null);
  const scrollOnOpen = useRef(false);
  // `upgrade` distingue o teto do plano de uma falha: no primeiro caso o
  // rascunho não foi guardado e **não adianta** tentar de novo neste mês.
  const [error, setError] = useState<{
    message: string;
    upgrade: boolean;
  } | null>(null);
  const [armed, setArmed] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const open = opened || draft !== null;
  const filled =
    (draft?.title.trim().length ?? 0) > 0 ||
    (draft?.content.trim().length ?? 0) > 0;

  useEffect(() => {
    if (opened) titleRef.current?.focus();
  }, [opened]);

  useEffect(() => {
    registerOpen?.(() => {
      scrollOnOpen.current = true;
      setOpened(true);
    });
  }, [registerOpen]);

  useEffect(() => {
    if (!opened || !scrollOnOpen.current) return;
    scrollOnOpen.current = false;
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [opened]);

  // O armado da exclusão não pode sobreviver ao contexto que o criou: se a
  // pessoa saiu para escrever e voltou, o segundo clique não é confirmação
  // de nada.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  /**
   * "N" abre o rascunho.
   *
   * Sem Ctrl de propósito: Ctrl+N abre uma janela do navegador e a página não
   * consegue impedir isso — prometer um atalho que o sistema operacional
   * intercepta é pior que não ter atalho.
   */
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "n" && event.key !== "N") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target;
      // Digitar "n" dentro de um campo é digitar "n".
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      // Num menu aberto, "n" é busca por digitação — o Radix já o usa.
      if (document.querySelector("[role='menu']")) return;

      event.preventDefault();
      setOpened(true);
      titleRef.current?.focus();
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Esc sai do modo tela cheia. O botão continua lá para quem prefere clicar.
  useEffect(() => {
    if (!expanded) return;

    function handleKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setExpanded(false);
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [expanded]);

  async function save() {
    if (!draft || !filled) return;

    setSaving(true);
    setError(null);
    try {
      // Com documento, manda o documento e deixa o servidor derivar o texto
      // puro — mesma regra do `PATCH /api/notes/[id]`. Sem documento (rascunho
      // criado antes do editor), manda o texto puro como sempre.
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          draft.contentRich !== undefined
            ? { title: draft.title, contentRich: draft.contentRich }
            : { title: draft.title, content: draft.content }
        ),
      });

      if (!response.ok) {
        setError(
          await readApiFailure(response, "Não foi possível guardar agora.")
        );
        return;
      }

      const { note } = await response.json();
      // Só depois da confirmação. Até aqui o rascunho é a única cópia que
      // existe deste texto no mundo.
      discard();
      setOpened(false);
      setExpanded(false);
      onSaved(note.title);
    } catch {
      setError({
        message: "Sem conexão. O rascunho continua aqui.",
        upgrade: false,
      });
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    // A preferência só esconde o convite vazio. Havendo rascunho com texto,
    // `open` já é `true` acima e este ramo nem é alcançado.
    if (hideDraft) return null;

    return (
      <button
        ref={(el) => {
          rootRef.current = el;
        }}
        type="button"
        onClick={() => setOpened(true)}
        className="group mt-3 flex w-full items-center gap-3 rounded-2xl border border-dashed border-border bg-background px-4 py-3.5 text-left transition-[background-color,border-color,transform] duration-150 hover:border-subtle-foreground hover:bg-secondary active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:active:scale-100"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-subtle-foreground transition-[background-color,color,transform] duration-150 group-hover:translate-x-0.5 group-hover:bg-tertiary group-hover:text-foreground motion-reduce:group-hover:translate-x-0">
          <PenLine className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            Escrever um rascunho
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            Fica neste navegador até você decidir guardar.
          </span>
        </span>
        <kbd className="hidden shrink-0 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-subtle-foreground sm:block">
          N
        </kbd>
      </button>
    );
  }

  return (
    <section
      ref={(el) => {
        rootRef.current = el;
      }}
      aria-label="Rascunho"
      className={cn(
        "mt-3 overflow-hidden rounded-2xl border border-border bg-background",
        opened && !expanded && "animate-draft-open motion-reduce:animate-none",
        expanded &&
          "fixed inset-0 z-50 m-0 flex flex-col rounded-none border-0"
      )}
    >
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-subtle-foreground">
          <PenLine className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Rascunho</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Só neste navegador — não entra na busca nem vai para o celular.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            title={expanded ? "Sair da tela cheia" : "Maximizar o rascunho"}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-[background-color,color,transform] duration-150 hover:bg-secondary hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:active:scale-100"
          >
            {expanded ? (
              <Minimize2 className="size-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="size-3.5" aria-hidden="true" />
            )}
            <span className="sr-only">
              {expanded ? "Sair da tela cheia" : "Maximizar o rascunho"}
            </span>
          </button>

          {!filled && (
            <button
              type="button"
              onClick={() => {
                discard();
                setOpened(false);
              }}
              title="Fechar o rascunho"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-[background-color,color,transform] duration-150 hover:bg-secondary hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:active:scale-100"
            >
              <X className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Fechar o rascunho</span>
            </button>
          )}
        </div>
      </div>

      <div
        className={cn(
          "min-h-0 bg-background",
          expanded && "flex flex-1 flex-col"
        )}
      >
        <label className="sr-only" htmlFor="draft-title">
          Título do rascunho
        </label>
        <input
          id="draft-title"
          ref={titleRef}
          value={draft?.title ?? ""}
          onChange={(event) => update({ title: event.target.value })}
          placeholder="Título"
          maxLength={200}
          data-focus-ring="container"
          className="w-full bg-transparent px-4 pt-4 pb-2 text-lg font-bold tracking-[-0.02em] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        />

        {/* Edição de nota cheia — negrito, títulos, listas —, só que este
            documento vive no `localStorage` e não no banco. */}
        <DraftEditor
          initialDoc={draft?.contentRich ?? null}
          plainFallback={draft?.content ?? ""}
          expanded={expanded}
          onChange={(doc) =>
            update({ contentRich: doc, content: richTextToPlain(doc) })
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-border bg-secondary px-4 py-3">
        <button
          type="button"
          onClick={save}
          disabled={!filled || saving}
          className="flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground transition-[background-color,transform] duration-150 hover:bg-accent/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-secondary disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11 motion-reduce:active:scale-100"
        >
          {saving && (
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
          )}
          Guardar na conta
        </button>

        {filled && (
          // Dois passos, como no menu do botão direito: um clique só apagaria
          // texto que não existe em nenhum outro lugar.
          <button
            type="button"
            onClick={() => {
              if (!armed) {
                setArmed(true);
                return;
              }
              discard();
              setArmed(false);
              setOpened(false);
            }}
            className={cn(
              "flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-secondary pointer-coarse:h-11 motion-reduce:active:scale-100",
              armed
                ? "bg-error/10 text-error"
                : "text-muted-foreground hover:bg-tertiary hover:text-foreground"
            )}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {armed ? "Descartar mesmo" : "Descartar"}
          </button>
        )}

        {/* O teto do plano não trunca: a frase inteira precisa ser lida, e o
            caminho para os planos vem depois dela. Os demais avisos continuam
            numa linha só — eles cabem. */}
        <p
          role="status"
          className={cn(
            "basis-full text-xs leading-relaxed sm:ml-auto sm:basis-auto sm:text-right",
            error?.upgrade
              ? "text-muted-foreground"
              : error
                ? "truncate text-error"
                : "truncate text-subtle-foreground"
          )}
        >
          {error ? (
            <>
              {error.message} {error.upgrade && <UpgradeLink />}
            </>
          ) : filled ? (
            "Guardado neste navegador."
          ) : (
            ""
          )}
        </p>
      </div>
    </section>
  );
}
