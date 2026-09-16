"use client";

import {
  ArrowDownAZ,
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  CircleDashed,
  FileText,
  LoaderCircle,
  Search,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  type NoteListResult,
  type NoteListSort,
  type NoteListSource,
  type NoteListType,
} from "@/lib/notes/list";
import { TAG_CHIP_CLASS, tagTone } from "@/lib/tags/palette";
import { cn } from "@/lib/utils";

const SEARCH_DELAY_MS = 250;

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
  initial: NoteListResult;
  renderedAt: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<NoteListSource>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<NoteListSort>("updated");
  const [result, setResult] = useState(initial);
  const [status, setStatus] = useState<"idle" | "loading" | "more" | "error">(
    "idle"
  );
  const [now, setNow] = useState(renderedAt);
  const firstRequest = useRef(true);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (firstRequest.current) {
      firstRequest.current = false;
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
      setStatus("idle");
    } catch (error) {
      if ((error as Error).name !== "AbortError") setStatus("error");
    }
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
                ? "Atualizando…"
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
              <NotesSkeleton />
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
                <ul className="divide-y divide-border border-y border-border">
                  {result.notes.map((note) => (
                    <NoteRow
                      key={note.id}
                      note={note}
                      now={now}
                      onOpen={() => router.push(`/nota/${note.id}`)}
                    />
                  ))}
                </ul>

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
  onOpen,
}: {
  note: NoteListItem;
  now: number;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-1 py-5 text-left transition-colors hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-4"
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

function NotesSkeleton() {
  return (
    <div className="divide-y divide-border border-y border-border" aria-label="Carregando notas">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex gap-3 px-1 py-5 sm:px-4">
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
