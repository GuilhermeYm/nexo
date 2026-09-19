"use client";

import { Check, Link2, Pencil, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * As referências da nota: os links que ela cita.
 *
 * Moram numa coluna própria (`notes.reference_links`, drizzle/0032), fora do
 * documento — não entram na busca nem no resumo, e ficam **sempre no fim**,
 * como as referências de um texto impresso.
 *
 * **Tela e papel mostram coisas diferentes, de propósito.** Na tela, o título
 * é o link e embaixo vai só o domínio: a URL inteira é ruído quando dá para
 * clicar. No PDF exportado o link não clica, então o endereço sai por extenso,
 * quebrando onde precisar — é ele que permite a quem lê o papel chegar lá.
 *
 * Sem referência nenhuma, a tela mostra só o convite "Adicionar referência"
 * e o PDF não mostra nada: um título "Referências" com a lista vazia seria
 * chrome impresso.
 */

export interface NoteReference {
  url: string;
  title: string;
}

const MAX_REFERENCES = 50;

/**
 * "exemplo.com/artigo" vira "https://exemplo.com/artigo". Qualquer outro
 * protocolo é recusado — o `href` vai para a tela e para o PDF, e um
 * `javascript:` guardado aqui viraria script no clique. O servidor refaz a
 * mesma conferência.
 */
function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? value
    : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost")
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function NoteReferences({
  initial,
  onChange,
}: {
  initial: NoteReference[];
  onChange: (references: NoteReference[]) => void;
}) {
  const [references, setReferences] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const headingId = useId();

  function commit(next: NoteReference[]) {
    setReferences(next);
    onChange(next);
  }

  const empty = references.length === 0;

  if (empty && !adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-10 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground motion-reduce:transition-none pointer-coarse:h-11 print:hidden"
      >
        <Link2 className="size-4" aria-hidden="true" />
        Adicionar referência
      </button>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn("mt-12 print:mt-10", empty && "print:hidden")}
    >
      <h2
        id={headingId}
        className="text-sm font-semibold tracking-[-0.01em] text-foreground font-[family-name:var(--font-display)]"
      >
        Referências
      </h2>

      {!empty && (
        <ol className="mt-3 border-t border-border">
          {references.map((reference, index) =>
            editingIndex === index ? (
              <li
                key={`${reference.url}-${index}`}
                className="border-b border-border py-2"
              >
                <ReferenceForm
                  initial={reference}
                  submitLabel="Salvar"
                  onCancel={() => setEditingIndex(null)}
                  onSubmit={(next) => {
                    commit(
                      references.map((item, i) => (i === index ? next : item))
                    );
                    setEditingIndex(null);
                  }}
                />
              </li>
            ) : (
              <ReferenceRow
                key={`${reference.url}-${index}`}
                index={index}
                reference={reference}
                onEdit={() => {
                  setAdding(false);
                  setEditingIndex(index);
                }}
                onRemove={() =>
                  commit(references.filter((_, i) => i !== index))
                }
              />
            )
          )}
        </ol>
      )}

      <div className="print:hidden">
        {adding ? (
          <div
            className={cn(
              "py-2",
              empty ? "mt-3 border-y border-border" : "border-b border-border"
            )}
          >
            <ReferenceForm
              autoFocus
              submitLabel="Adicionar"
              onCancel={() => setAdding(false)}
              onSubmit={(next) => {
                commit([...references, next]);
                // Continua aberto: quem cola um link costuma ter o próximo.
              }}
            />
          </div>
        ) : (
          references.length < MAX_REFERENCES && (
            <button
              type="button"
              onClick={() => {
                setEditingIndex(null);
                setAdding(true);
              }}
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground motion-reduce:transition-none pointer-coarse:h-11"
            >
              <Plus className="size-4" aria-hidden="true" />
              Adicionar referência
            </button>
          )
        )}
      </div>
    </section>
  );
}

function ReferenceRow({
  index,
  reference,
  onEdit,
  onRemove,
}: {
  index: number;
  reference: NoteReference;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const host = hostOf(reference.url);

  return (
    <li className="group/ref flex items-start gap-3 border-b border-border py-2.5 print:break-inside-avoid print:py-2">
      <span
        aria-hidden="true"
        className="w-5 shrink-0 pt-px text-right text-xs leading-5 tabular-nums text-subtle-foreground"
      >
        {index + 1}.
      </span>

      <div className="min-w-0 flex-1">
        <a
          href={reference.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm leading-5 font-medium text-foreground underline decoration-border decoration-1 underline-offset-[5px] transition-colors duration-150 hover:decoration-foreground motion-reduce:transition-none print:no-underline"
        >
          {reference.title || host}
        </a>
        {/* Na tela, o domínio; no papel, o endereço inteiro. */}
        <p className="mt-0.5 truncate text-xs text-subtle-foreground print:hidden">
          {host}
        </p>
        <p className="mt-0.5 hidden text-xs break-all text-subtle-foreground print:block">
          {reference.url}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/ref:opacity-100 group-focus-within/ref:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100 print:hidden">
        <button
          type="button"
          onClick={onEdit}
          title="Editar"
          className="grid size-7 place-items-center rounded-md text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:size-10"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Editar a referência {index + 1}</span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="Tirar"
          className="grid size-7 place-items-center rounded-md text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:size-10"
        >
          <X className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Tirar a referência {index + 1}</span>
        </button>
      </div>
    </li>
  );
}

/**
 * O link e, opcional, o título. Enter no link já adiciona — colar e apertar
 * Enter é o caminho mais comum, e o título pode vir depois pelo lápis.
 */
function ReferenceForm({
  initial,
  submitLabel,
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  initial?: NoteReference;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (reference: NoteReference) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    if (autoFocus || initial) urlRef.current?.focus({ preventScroll: true });
  }, [autoFocus, initial]);

  function submit() {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setError(
        "Esse link não parece um endereço da web. Confira e tente de novo."
      );
      urlRef.current?.focus();
      return;
    }
    onSubmit({ url: normalized, title: title.trim().slice(0, 200) });
    if (!initial) {
      setUrl("");
      setTitle("");
      setError(null);
      urlRef.current?.focus();
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  const field =
    "h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-subtle-foreground focus:border-subtle-foreground motion-reduce:transition-none pointer-coarse:h-11";

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={urlRef}
          type="url"
          inputMode="url"
          aria-label="Link"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="Cole um link"
          maxLength={2048}
          data-focus-ring="container"
          className={cn(field, "sm:flex-[3]", error && "border-error")}
        />
        <input
          aria-label="Título (opcional)"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Título (opcional)"
          maxLength={200}
          data-focus-ring="container"
          className={cn(field, "sm:flex-[2]")}
        />
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={submit}
            disabled={!url.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-90 disabled:opacity-40 motion-reduce:transition-none pointer-coarse:h-11"
          >
            <Check className="size-4" aria-hidden="true" />
            {submitLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            title="Cancelar"
            className="grid size-9 place-items-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:size-11"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Cancelar</span>
          </button>
        </div>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
