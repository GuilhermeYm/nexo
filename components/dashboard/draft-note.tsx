"use client";

import { LoaderCircle, PenLine, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useLocalDraft } from "@/hooks/use-local-draft";
import { cn } from "@/lib/utils";

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
}

export function DraftNote({ onSaved }: DraftNoteProps) {
  const { draft, update, discard } = useLocalDraft();
  const [opened, setOpened] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const open = opened || draft !== null;
  const filled =
    (draft?.title.trim().length ?? 0) > 0 ||
    (draft?.content.trim().length ?? 0) > 0;

  useEffect(() => {
    if (opened) titleRef.current?.focus();
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

  async function save() {
    if (!draft || !filled) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title, content: draft.content }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Não foi possível guardar agora.");
        return;
      }

      const { note } = await response.json();
      // Só depois da confirmação. Até aqui o rascunho é a única cópia que
      // existe deste texto no mundo.
      discard();
      setOpened(false);
      onSaved(note.title);
    } catch {
      setError("Sem conexão. O rascunho continua aqui.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpened(true)}
        className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border px-4 py-3 text-left transition-colors duration-150 hover:border-subtle-foreground hover:bg-secondary"
      >
        <PenLine
          className="size-4 shrink-0 text-subtle-foreground"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">
          Escrever um rascunho{" "}
          <span className="text-subtle-foreground">
            — fica só neste navegador
          </span>
        </span>
        <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-subtle-foreground sm:block">
          N
        </kbd>
      </button>
    );
  }

  return (
    <section
      aria-label="Rascunho"
      className="mt-3 rounded-xl border border-border bg-secondary p-3"
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <PenLine
          className="size-3.5 shrink-0 text-subtle-foreground"
          aria-hidden="true"
        />
        <h2 className="text-[11px] font-semibold tracking-wide text-subtle-foreground uppercase">
          Rascunho
        </h2>
        <p className="min-w-0 flex-1 truncate text-xs text-subtle-foreground">
          Fica só neste navegador — não entra na busca nem vai para o celular.
        </p>
        {!filled && (
          <button
            type="button"
            onClick={() => setOpened(false)}
            title="Fechar o rascunho"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Fechar o rascunho</span>
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background p-2.5">
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
          className="w-full rounded-md bg-transparent px-1 py-1 text-base font-bold tracking-[-0.01em] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-subtle-foreground focus-visible:ring-inset"
        />

        <label className="sr-only" htmlFor="draft-content">
          Texto do rascunho
        </label>
        <textarea
          id="draft-content"
          value={draft?.content ?? ""}
          onChange={(event) => update({ content: event.target.value })}
          placeholder="Escreva à vontade. Nada daqui sai do seu navegador até você mandar."
          rows={4}
          maxLength={20_000}
          data-focus-ring="container"
          className="mt-1 w-full resize-y rounded-md bg-transparent px-1 py-1 text-sm leading-relaxed text-muted-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-subtle-foreground focus-visible:ring-inset"
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 px-1">
        <button
          type="button"
          onClick={save}
          disabled={!filled || saving}
          className="flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground transition-colors duration-150 hover:bg-accent/90 disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11"
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
              "flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors duration-150 pointer-coarse:h-11",
              armed
                ? "bg-error/10 text-error"
                : "text-muted-foreground hover:bg-tertiary hover:text-foreground"
            )}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {armed ? "Descartar mesmo" : "Descartar"}
          </button>
        )}

        <p
          role="status"
          className={cn(
            "ml-auto min-w-0 truncate text-xs",
            error ? "text-error" : "text-subtle-foreground"
          )}
        >
          {error ?? (filled ? "Guardado neste navegador." : "")}
        </p>
      </div>
    </section>
  );
}
