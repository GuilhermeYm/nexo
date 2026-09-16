"use client";

import {
  ArrowDownAZ,
  ArrowLeft,
  BookOpen,
  CalendarClock,
  ChevronDown,
  CircleDashed,
  Clock3,
  ExternalLink,
  FileText,
  LoaderCircle,
  Search,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  NOTE_TYPE_LABEL,
  NoteTypeIcon,
} from "@/components/dashboard/note-type-icon";
import { Input } from "@/components/ui/input";
import {
  formatAbsolute,
  formatRelative,
  toIsoString,
} from "@/lib/dashboard/format";
import {
  NOTE_TYPES,
  type NoteListItem,
  type NotePreview,
  type NoteListResult,
  type NoteListSort,
  type NoteListSource,
  type NoteListType,
} from "@/lib/notes/list";
import { TAG_CHIP_CLASS, tagTone } from "@/lib/tags/palette";
import { cn } from "@/lib/utils";

const SEARCH_DELAY_MS = 250;

const EMPTY_NOTE_LIST: NoteListResult = {
  notes: [],
  total: 0,
  page: 1,
  pageSize: 18,
  hasMore: false,
};

type TypeFilter = NoteListType | "all";

const SORT_OPTIONS: { value: NoteListSort; label: string }[] = [
  { value: "updated", label: "Atualizadas recentemente" },
  { value: "created", label: "Criadas recentemente" },
  { value: "title", label: "Título de A a Z" },
];

export function NotesView({
  initial,
  renderedAt,
}: {
  initial: NoteListResult | null;
  renderedAt: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const previewRequestRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<NoteListSource>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<NoteListSort>("updated");
  const [result, setResult] = useState(initial ?? EMPTY_NOTE_LIST);
  const [status, setStatus] = useState<"idle" | "loading" | "more" | "error">(
    initial ? "idle" : "loading"
  );
  const [hasLoadedInitial, setHasLoadedInitial] = useState(initial !== null);
  const [now, setNow] = useState(renderedAt);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [preview, setPreview] = useState<NotePreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "error">(
    "idle"
  );
  const firstRequest = useRef(true);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (firstRequest.current) {
      firstRequest.current = false;
      if (!initial) void loadPage(1, false);
      return;
    }

    const timer = setTimeout(() => {
      void loadPage(1, false);
    }, query.trim() ? SEARCH_DELAY_MS : 0);

    return () => clearTimeout(timer);
    // `loadPage` intentionally reads the current controls. The four values
    // below are the only events that start a fresh inventory request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, source, type, sort]);

  async function loadPage(page: number, append: boolean) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus(append ? "more" : "loading");

    const params = new URLSearchParams({
      q: query.trim(),
      source,
      type,
      sort,
      page: String(page),
    });

    try {
      const response = await fetch(`/api/notes?${params}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("request failed");
      const next: NoteListResult = await response.json();
      setResult((current) => ({
        ...next,
        notes: append ? [...current.notes, ...next.notes] : next.notes,
      }));
      if (!append) setHasLoadedInitial(true);
      setStatus("idle");
    } catch (error) {
      if ((error as Error).name !== "AbortError") setStatus("error");
    }
  }

  async function showPreview(noteId: string) {
    previewRequestRef.current?.abort();
    const controller = new AbortController();
    previewRequestRef.current = controller;
    setSelectedNoteId(noteId);
    setPreview(null);
    setPreviewStatus("loading");

    window.requestAnimationFrame(() => {
      previewRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "nearest",
      });
    });

    try {
      const response = await fetch(`/api/notes/${noteId}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("preview request failed");
      const body = (await response.json()) as { note: NotePreview };
      if (!controller.signal.aborted) {
        setPreview(body.note);
        setPreviewStatus("idle");
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") setPreviewStatus("error");
    }
  }

  function closePreview() {
    previewRequestRef.current?.abort();
    setSelectedNoteId(null);
    setPreview(null);
    setPreviewStatus("idle");
  }

  const filtered = query.trim() || source !== "all" || type !== "all";

  function clearFilters() {
    setQuery("");
    setSource("all");
    setType("all");
    setSort("updated");
    inputRef.current?.focus();
  }

  return (
    <div className="flex min-h-dvh bg-secondary p-2 sm:p-3">
      <main className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-background">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-8 sm:px-7 sm:py-12 lg:px-10">
          <Link
            href="/dashboard"
            className="flex w-fit items-center gap-1.5 rounded-lg py-1 pr-2 text-sm text-subtle-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Início
          </Link>

          <header className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <FileText className="size-5" aria-hidden="true" />
                </span>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[30px]">
                  Suas notas
                </h1>
              </div>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Tudo o que você escreveu e o que a Nexo criou para você, no
                mesmo lugar.
              </p>
            </div>
            <p
              aria-live="polite"
              className="text-sm tabular-nums text-subtle-foreground"
            >
              {status === "loading"
                ? hasLoadedInitial
                  ? "Atualizando…"
                  : "Buscando no servidor…"
                : `${result.total} ${result.total === 1 ? "nota" : "notas"}`}
            </p>
          </header>

          <section aria-label="Filtros de notas" className="mt-8">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-subtle-foreground"
                aria-hidden="true"
              />
              <Input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    if (query) setQuery("");
                    else inputRef.current?.blur();
                  }
                }}
                placeholder="Buscar no título e no conteúdo…"
                aria-label="Buscar notas"
                className="h-12 pr-11 pl-11 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  className="absolute top-1/2 right-3 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="size-4" aria-hidden="true" />
                  <span className="sr-only">Limpar busca</span>
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex w-fit rounded-xl bg-secondary p-1" aria-label="Filtrar por autoria">
                <SourceButton active={source === "all"} onClick={() => setSource("all")}>
                  Todas
                </SourceButton>
                <SourceButton active={source === "user"} onClick={() => setSource("user")}>
                  <UserRound className="size-3.5" aria-hidden="true" />
                  Você
                </SourceButton>
                <SourceButton active={source === "ai"} onClick={() => setSource("ai")}>
                  <Sparkles className="size-3.5" aria-hidden="true" />
                  Nexo
                </SourceButton>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <SelectControl
                  label="Tipo"
                  value={type}
                  onChange={(value) => setType(value as TypeFilter)}
                  options={[
                    { value: "all", label: "Todos os tipos" },
                    ...NOTE_TYPES.map((value) => ({
                      value,
                      label: NOTE_TYPE_LABEL[value],
                    })),
                  ]}
                />
                <SelectControl
                  label="Ordenar"
                  value={sort}
                  onChange={(value) => setSort(value as NoteListSort)}
                  options={SORT_OPTIONS}
                  icon={sort === "title" ? ArrowDownAZ : CalendarClock}
                />
              </div>
            </div>
          </section>

          <section className="mt-8 flex flex-1 flex-col" aria-busy={status === "loading"}>
            {status === "error" ? (
              <MessageState
                title="As notas não carregaram"
                description="Confira a conexão e tente de novo. Seus filtros continuam aqui."
                action={{ label: "Tentar novamente", onClick: () => void loadPage(1, false) }}
              />
            ) : status === "loading" ? (
              <NotesSkeleton
                message={
                  hasLoadedInitial
                    ? "Atualizando suas notas…"
                    : "Buscando suas notas no servidor…"
                }
              />
            ) : result.notes.length === 0 ? (
              <MessageState
                title={filtered ? "Nenhuma nota combina com isso" : "Seu acervo começa aqui"}
                description={
                  filtered
                    ? "Tente outra palavra ou remova um dos filtros."
                    : "Quando você escrever ou a Nexo criar uma nota, ela vai aparecer aqui."
                }
                action={filtered ? { label: "Limpar filtros", onClick: clearFilters } : undefined}
              />
            ) : (
              <>
                <div
                  className={cn(
                    "grid min-h-0 gap-6",
                    selectedNoteId && "lg:grid-cols-[minmax(0,1fr)_minmax(21rem,0.8fr)]"
                  )}
                >
                  <ul className="divide-y divide-border border-y border-border">
                    {result.notes.map((note) => (
                      <NoteRow
                        key={note.id}
                        note={note}
                        now={now}
                        selected={note.id === selectedNoteId}
                        onSelect={() => void showPreview(note.id)}
                      />
                    ))}
                  </ul>

                  {selectedNoteId && (
                    <aside
                      ref={previewRef}
                      className="order-first lg:order-none lg:sticky lg:top-5 lg:max-h-[calc(100dvh-3.5rem)]"
                      aria-label="Prévia da nota"
                    >
                      <NotePreviewPanel
                        preview={preview}
                        status={previewStatus}
                        now={now}
                        onClose={closePreview}
                        onRetry={() => void showPreview(selectedNoteId)}
                      />
                    </aside>
                  )}
                </div>

                {result.hasMore && (
                  <button
                    type="button"
                    onClick={() => void loadPage(result.page + 1, true)}
                    disabled={status === "more"}
                    className="mx-auto mt-7 flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-60"
                  >
                    {status === "more" && (
                      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    )}
                    {status === "more" ? "Carregando…" : "Mostrar mais"}
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function SourceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm transition-[background-color,color,box-shadow] duration-150",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-subtle-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function SelectControl({
  label,
  value,
  onChange,
  options,
  icon: Icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  icon?: typeof CalendarClock;
}) {
  return (
    <label className="relative flex items-center">
      <span className="sr-only">{label}</span>
      {Icon && <Icon className="pointer-events-none absolute left-3 size-4 text-subtle-foreground" aria-hidden="true" />}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-9 min-w-44 appearance-none rounded-xl border border-border bg-background pr-9 text-sm text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-accent/40",
          Icon ? "pl-9" : "pl-3"
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-subtle-foreground" aria-hidden="true" />
    </label>
  );
}

function NoteRow({
  note,
  now,
  selected,
  onSelect,
}: {
  note: NoteListItem;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        title="Clique para ler a prévia"
        className={cn(
          "group grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-1 py-5 text-left transition-colors hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-4",
          selected && "bg-secondary/65"
        )}
      >
        <span className="mt-0.5 flex size-9 items-center justify-center rounded-xl bg-secondary text-subtle-foreground transition-colors group-hover:text-foreground">
          <NoteTypeIcon type={note.type} className="size-[18px]" />
        </span>

        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] font-medium text-foreground">
              {note.title}
            </span>
            {note.source === "ai" && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                <Sparkles className="size-3" aria-hidden="true" />
                Nexo
              </span>
            )}
          </span>

          {note.excerpt ? (
            <span className="mt-1.5 line-clamp-2 block max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {note.excerpt}
            </span>
          ) : (
            <span className="mt-1.5 flex items-center gap-1.5 text-sm text-subtle-foreground">
              <CircleDashed className="size-3.5 shrink-0" aria-hidden="true" />
              Nota vazia · abra para começar a escrever
            </span>
          )}

          <span className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-subtle-foreground">
            <span>{NOTE_TYPE_LABEL[note.type] ?? "Nota"}</span>
            {note.workspaceName && <><Dot /><span>{note.workspaceName}</span></>}
            {note.tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className={cn(
                  "rounded-md px-1.5 py-0.5",
                  TAG_CHIP_CLASS[tagTone(tag)]
                )}
              >
                {tag.name}
              </span>
            ))}
            {note.tags.length > 3 && <span>+{note.tags.length - 3}</span>}
          </span>
        </span>

        <time
          dateTime={toIsoString(note.updatedAt)}
          title={formatAbsolute(note.updatedAt)}
          suppressHydrationWarning
          className="col-start-2 mt-2 shrink-0 text-xs tabular-nums text-subtle-foreground sm:col-start-3 sm:row-start-1 sm:mt-1"
        >
          {formatRelative(note.updatedAt, now)}
        </time>
      </button>
    </li>
  );
}

function NotePreviewPanel({
  preview,
  status,
  now,
  onClose,
  onRetry,
}: {
  preview: NotePreview | null;
  status: "idle" | "loading" | "error";
  now: number;
  onClose: () => void;
  onRetry: () => void;
}) {
  if (status === "loading") {
    return <PreviewSkeleton onClose={onClose} />;
  }

  if (status === "error") {
    return (
      <section className="rounded-2xl border border-border bg-background p-5 lg:h-full">
        <PreviewHeader onClose={onClose} />
        <div className="flex min-h-52 flex-col items-center justify-center px-4 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-subtle-foreground">
            <BookOpen className="size-5" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-sm font-semibold text-foreground">
            A prévia não carregou
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Confira a conexão e tente novamente.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
          >
            Tentar novamente
          </button>
        </div>
      </section>
    );
  }

  if (!preview) return null;

  return (
    <section className="flex max-h-[min(34rem,calc(100dvh-3.5rem))] flex-col rounded-2xl border border-border bg-background animate-row-in motion-reduce:animate-none lg:h-full lg:max-h-none">
      <div className="shrink-0 border-b border-border px-5 py-4">
        <PreviewHeader onClose={onClose} />
        <div className="mt-4 flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-subtle-foreground">
            <NoteTypeIcon type={preview.type} className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-snug tracking-tight text-foreground">
              {preview.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle-foreground">
              <span>{NOTE_TYPE_LABEL[preview.type] ?? "Nota"}</span>
              {preview.source === "ai" && (
                <span className="inline-flex items-center gap-1 text-accent">
                  <Sparkles className="size-3" aria-hidden="true" />
                  pela Nexo
                </span>
              )}
              {preview.workspaceName && <><Dot /><span>{preview.workspaceName}</span></>}
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {preview.content ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
            {preview.content}
          </p>
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center text-center">
            <CircleDashed className="size-5 text-subtle-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm text-muted-foreground">
              Esta nota ainda está vazia.
            </p>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3.5">
        <span
          className="flex min-w-0 items-center gap-1.5 text-xs tabular-nums text-subtle-foreground"
          title={formatAbsolute(preview.updatedAt)}
        >
          <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
          Atualizada {formatRelative(preview.updatedAt, now)}
        </span>
        <Link
          href={`/nota/${preview.id}`}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Abrir no editor
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function PreviewHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-subtle-foreground">Prévia</span>
      <button
        type="button"
        onClick={onClose}
        className="flex size-7 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <X className="size-4" aria-hidden="true" />
        <span className="sr-only">Fechar prévia</span>
      </button>
    </div>
  );
}

function PreviewSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <section
      className="rounded-2xl border border-border bg-background p-5 animate-row-in motion-reduce:animate-none lg:h-full"
      aria-busy="true"
      aria-live="polite"
    >
      <PreviewHeader onClose={onClose} />
      <div className="mt-5 flex items-center gap-2 text-sm text-subtle-foreground">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Carregando prévia…
      </div>
      <div className="mt-5 flex items-start gap-3">
        <span className="size-9 shrink-0 animate-pulse rounded-xl bg-secondary motion-reduce:animate-none" />
        <span className="min-w-0 flex-1 space-y-2">
          <span className="block h-5 w-3/4 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
          <span className="block h-3 w-2/5 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
        </span>
      </div>
      <div className="mt-8 space-y-3">
        {[100, 88, 94, 64, 76].map((width) => (
          <span
            key={width}
            className="block h-3 animate-pulse rounded bg-secondary motion-reduce:animate-none"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    </section>
  );
}

function Dot() {
  return <span aria-hidden="true" className="size-0.5 rounded-full bg-subtle-foreground" />;
}

function MessageState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-20 text-center">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-secondary text-subtle-foreground">
        <FileText className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      {action && (
        <button type="button" onClick={action.onClick} className="mt-5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90">
          {action.label}
        </button>
      )}
    </div>
  );
}

function NotesSkeleton({ message }: { message: string }) {
  return (
    <div className="divide-y divide-border border-y border-border" aria-busy="true" aria-live="polite">
      <p className="flex items-center gap-2 px-1 py-3 text-sm text-subtle-foreground sm:px-4">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {message}
      </p>
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="flex gap-3 px-1 py-5 animate-row-in motion-reduce:animate-none sm:px-4"
          style={{ animationDelay: `${index * 45}ms` }}
        >
          <span className="size-9 shrink-0 animate-pulse rounded-xl bg-secondary motion-reduce:animate-none" />
          <span className="flex-1">
            <span className="block h-4 w-2/5 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
            <span className="mt-2 block h-3 w-4/5 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
            <span className="mt-3 block h-3 w-1/3 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
          </span>
        </div>
      ))}
    </div>
  );
}
