"use client";

import {
  ArrowLeft,
  GitFork,
  Hash,
  List,
  LoaderCircle,
  Search,
  Tags as TagsIcon,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { NoteTypeIcon } from "@/components/dashboard/note-type-icon";
import { RowSkeleton } from "@/components/dashboard/panel";
import { Input } from "@/components/ui/input";
import {
  formatAbsolute,
  formatRelative,
  toIsoString,
} from "@/lib/dashboard/format";
import type { RecentNote } from "@/lib/dashboard/queries";
import {
  TAG_CHIP_CLASS,
  TAG_DOT_CLASS,
  tagTone,
} from "@/lib/tags/palette";
import type { TagWithUsage, TagGraph } from "@/lib/tags/queries";
import { cn } from "@/lib/utils";
import { TagsGraph } from "./tags-graph";

/**
 * Quantas tags ficam à vista sem busca. A página existe para reencontrar, não
 * para inventariar: quem tem 80 etiquetas não as percorre com os olhos, digita
 * duas letras. As demais continuam alcançáveis pela busca — que filtra tags
 * no cliente, de graça, além de buscar notas no servidor.
 */
const RECENT_TAGS_LIMIT = 12;
const SEARCH_DEBOUNCE_MS = 220;

/**
 * A cor de cada tag vem de `tagTone`: a posição gravada em `tags.color`
 * quando existe, ou uma derivada do nome. Sem isso a tela seria toda cinza —
 * `color` nasce nulo e só as tags criadas na lousa o preenchem.
 */

/** Busca de tag sem tropeçar em acento: "pesquisa" encontra "pesquisa" e "Pesquisa". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function TagsView({
  tags,
  renderedAt,
  initialTagId = null,
}: {
  tags: TagWithUsage[];
  renderedAt: number;
  initialTagId?: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // As tags moram em estado: a troca de cor feita no grafo precisa chegar à
  // lista quando a pessoa volta para ela, sem novo fetch.
  const [allTags, setAllTags] = useState(tags);

  function handleTagColorChange(tagId: string, color: string | null) {
    setAllTags((current) =>
      current.map((tag) => (tag.id === tagId ? { ...tag, color } : tag))
    );
    setGraphData((current) =>
      current && current !== "error"
        ? {
            ...current,
            tags: current.tags.map((tag) =>
              tag.id === tagId ? { ...tag, color } : tag
            ),
          }
        : current
    );
  }

  /**
   * O menu da nota no grafo pode ter tirado, posto ou criado tags. Relê o
   * grafo em silêncio: se falhar, o desenho de antes continua valendo — e as
   * posições sobrevivem, porque o grafo carrega x/y pelo id.
   */
  async function refreshGraph() {
    try {
      const response = await fetch("/api/tags/graph");
      if (!response.ok) return;
      const payload = (await response.json()) as TagGraph;
      setGraphData(payload);
    } catch {
      // O grafo anterior fica na tela.
    }
  }

  // Relógio no padrão do dashboard: começa no instante do servidor para o
  // HTML bater, e só depois de montado passa a marcar o tempo de verdade.
  const [now, setNow] = useState(renderedAt);

  useEffect(() => {
    function tick() {
      setNow(Date.now());
    }
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<TagWithUsage | null>(
    () => tags.find((tag) => tag.id === initialTagId) ?? null
  );
  const [view, setView] = useState<"list" | "graph">("list");
  const [graphData, setGraphData] = useState<TagGraph | "error" | null>(null);

  // O resultado carrega a busca que o originou (mesmo padrão da barra de
  // comando): “está buscando” é derivado, sem um segundo estado para zerar.
  const [searchResults, setSearchResults] = useState<{
    query: string;
    items: RecentNote[];
  } | null>(null);
  const [tagNotes, setTagNotes] = useState<{
    tagId: string;
    items: RecentNote[];
  } | null>(null);

  /* --- Dados do grafo (sob demanda) --------------------------------------- */

  useEffect(() => {
    if (view !== "graph") return;
    if (graphData) return;

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/tags/graph");
        if (!response.ok || cancelled) {
          if (!cancelled) setGraphData("error");
          return;
        }
        const payload = await response.json();
        if (!cancelled) setGraphData(payload);
      } catch {
        if (!cancelled) setGraphData("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [view, graphData]);

  /* --- Busca de notas (servidor) --------------------------------------- */

  const searchAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      searchAbort.current?.abort();
      return;
    }

    const timer = setTimeout(async () => {
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;

      try {
        const response = await fetch(
          `/api/search?scope=notes&q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          setSearchResults({ query: trimmed, items: [] });
          return;
        }
        const payload = await response.json();
        setSearchResults({ query: trimmed, items: payload.notes ?? [] });
      } catch (error) {
        // Abort é o caso normal — uma busca mais nova cancelou esta.
        if ((error as Error)?.name !== "AbortError") {
          setSearchResults({ query: trimmed, items: [] });
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  /* --- Notas da tag selecionada ----------------------------------------- */

  const notesAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!selected) {
      notesAbort.current?.abort();
      return;
    }

    notesAbort.current?.abort();
    const controller = new AbortController();
    notesAbort.current = controller;
    const tagId = selected.id;

    (async () => {
      try {
        const response = await fetch(`/api/tags/${tagId}/notes`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          setTagNotes({ tagId, items: [] });
          return;
        }
        const payload = await response.json();
        setTagNotes({ tagId, items: payload.notes ?? [] });
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") {
          setTagNotes({ tagId, items: [] });
        }
      }
    })();

    return () => controller.abort();
  }, [selected]);

  /* --- Estado derivado --------------------------------------------------- */

  const trimmedQuery = query.trim();
  const foldedQuery = fold(trimmedQuery);
  // Filtrar tag no cliente custa nada — a lista já está aqui — e é o que
  // torna as tags antigas alcançáveis sem poluir a tela de descanso.
  const matchedTags = foldedQuery
    ? allTags.filter((tag) => fold(tag.name).includes(foldedQuery))
    : [];

  const currentSearch =
    searchResults?.query === trimmedQuery ? searchResults.items : null;
  const searching = trimmedQuery.length > 0 && currentSearch === null;

  const currentTagNotes =
    selected && tagNotes?.tagId === selected.id ? tagNotes.items : null;

  function selectTag(tag: TagWithUsage) {
    setSelected(tag);
    setQuery("");
  }

  const openNote = (noteId: string) => router.push(`/nota/${noteId}`);

  return (
    <div className="flex min-h-dvh bg-secondary p-3">
      {/* A mesma "janela" do dashboard: moldura arredondada sobre o fundo,
          para a página ler como mais um cômodo da mesma casa. */}
      <main className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-background">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10 sm:py-14">
          <Link
            href="/dashboard"
            className="flex w-fit items-center gap-1.5 rounded-lg py-1 pr-2 text-sm text-subtle-foreground transition-colors duration-150 hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Início
          </Link>

          <div className="mt-6 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground"
            >
              <Hash className="size-[18px]" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
              Tags
            </h1>
            {allTags.length > 0 && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {allTags.length}
              </span>
            )}
            <button
              type="button"
              onClick={() => setView(view === "list" ? "graph" : "list")}
              className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm text-subtle-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            >
              {view === "list" ? (
                <>
                  <GitFork className="size-4" aria-hidden="true" />
                  Ver como grafo
                </>
              ) : (
                <>
                  <List className="size-4" aria-hidden="true" />
                  Voltar para lista
                </>
              )}
            </button>
          </div>

          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
            As etiquetas que organizam as suas notas — as que você criou e as
            que a Nexo sugeriu ao classificar.
          </p>

          {/* Busca. Filtra as tags aqui mesmo e busca o conteúdo das notas
              no servidor — um campo só para as duas perguntas. */}
          <div className="relative mt-7">
            <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-subtle-foreground">
              {searching ? (
                <LoaderCircle
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Search className="size-4" aria-hidden="true" />
              )}
            </span>
            <Input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                // Digitar é um voto de saída da tag aberta: a pessoa foi
                // procurar outra coisa.
                if (selected) setSelected(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  if (query) {
                    setQuery("");
                  } else {
                    inputRef.current?.blur();
                  }
                }
              }}
              placeholder="Buscar notas e tags…"
              aria-label="Buscar notas e tags"
              className="pr-11 pl-11 [&::-webkit-search-cancel-button]:hidden"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute top-1/2 right-3 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-subtle-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">Limpar busca</span>
              </button>
            )}
          </div>

          <div className="mt-10">
            {view === "graph" ? (
              <div className="space-y-3">
                {graphData === "error" ? (
                  <div className="flex h-96 items-center justify-center rounded-2xl border border-border bg-secondary/40">
                    <span className="text-sm text-muted-foreground">
                      Não foi possível carregar o grafo.
                    </span>
                  </div>
                ) : graphData ? (
                  <TagsGraph
                    {...graphData}
                    onTagColorChange={handleTagColorChange}
                    onNoteTagsEdited={() => void refreshGraph()}
                  />
                ) : (
                  <div className="flex h-96 items-center justify-center rounded-2xl border border-border bg-secondary/40">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                      Carregando o grafo…
                    </span>
                  </div>
                )}
              </div>
            ) : trimmedQuery ? (
              <SearchResults
                matchedTags={matchedTags}
                notes={currentSearch}
                searching={searching}
                query={trimmedQuery}
                now={now}
                onSelectTag={selectTag}
                onOpenNote={openNote}
              />
            ) : selected ? (
              <SelectedTagNotes
                tag={selected}
                notes={currentTagNotes}
                now={now}
                onClear={() => setSelected(null)}
                onOpenNote={openNote}
              />
            ) : (
              <RecentTags tags={allTags} onSelectTag={selectTag} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

/**
 * A tela de descanso: as tags usadas por último. As demais não aparecem
 * aqui de propósito — elas estão a duas letras de distância, na busca.
 */
function RecentTags({
  tags,
  onSelectTag,
}: {
  tags: TagWithUsage[];
  onSelectTag: (tag: TagWithUsage) => void;
}) {
  if (tags.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-8 py-12 text-center">
        <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-subtle-foreground">
          <TagsIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="max-w-[38ch]">
          <p className="text-sm font-medium text-foreground">
            Nenhuma tag ainda
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Quando a Nexo classificar o que você guardar, as etiquetas aparecem
            aqui. Envie um arquivo pela barra do Início para ver acontecer.
          </p>
        </div>
      </div>
    );
  }

  const recent = tags.slice(0, RECENT_TAGS_LIMIT);
  const rest = tags.length - recent.length;

  return (
    <section aria-labelledby="recent-tags-heading">
      <h2
        id="recent-tags-heading"
        className="text-[11px] font-semibold tracking-wide text-subtle-foreground uppercase"
      >
        Usadas recentemente
      </h2>

      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {recent.map((tag) => (
          <li key={tag.id}>
            <TagCard tag={tag} onSelect={() => onSelectTag(tag)} />
          </li>
        ))}
      </ul>

      {rest > 0 && (
        <p className="mt-4 text-xs text-subtle-foreground">
          E mais {rest} {rest === 1 ? "tag" : "tags"} — aparecem na busca
          acima.
        </p>
      )}
    </section>
  );
}

/** Um cartão de tag: cor, nome e quantas notas ela marca. */
function TagCard({
  tag,
  onSelect,
}: {
  tag: TagWithUsage;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-xl border border-border px-4 py-3 text-left transition-colors duration-150 hover:border-subtle-foreground/60 hover:bg-secondary/50"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2.5 shrink-0 rounded-full",
          TAG_DOT_CLASS[tagTone(tag)]
        )}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        #{tag.name}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
        {tag.noteCount} {tag.noteCount === 1 ? "nota" : "notas"}
      </span>
    </button>
  );
}

/** As notas da tag aberta. */
function SelectedTagNotes({
  tag,
  notes,
  now,
  onClear,
  onOpenNote,
}: {
  tag: TagWithUsage;
  notes: RecentNote[] | null;
  now: number;
  onClear: () => void;
  onOpenNote: (noteId: string) => void;
}) {
  return (
    <section aria-labelledby="selected-tag-heading">
      <div className="flex items-center gap-2">
        <span
          id="selected-tag-heading"
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
            TAG_CHIP_CLASS[tagTone(tag)]
          )}
        >
          #{tag.name}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="flex size-7 items-center justify-center rounded-full text-subtle-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Voltar para todas as tags</span>
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border">
        {notes === null ? (
          <RowSkeleton rows={3} />
        ) : notes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhuma nota com esta tag.
          </p>
        ) : (
          <NoteList notes={notes} now={now} onOpenNote={onOpenNote} />
        )}
      </div>
    </section>
  );
}

/** O que a busca encontrou: primeiro as tags, depois as notas. */
function SearchResults({
  matchedTags,
  notes,
  searching,
  query,
  now,
  onSelectTag,
  onOpenNote,
}: {
  matchedTags: TagWithUsage[];
  notes: RecentNote[] | null;
  searching: boolean;
  query: string;
  now: number;
  onSelectTag: (tag: TagWithUsage) => void;
  onOpenNote: (noteId: string) => void;
}) {
  return (
    <div className="space-y-8">
      {matchedTags.length > 0 && (
        <section aria-labelledby="matched-tags-heading">
          <h2
            id="matched-tags-heading"
            className="text-[11px] font-semibold tracking-wide text-subtle-foreground uppercase"
          >
            Tags
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {matchedTags.map((tag) => (
              <li key={tag.id}>
                <TagCard tag={tag} onSelect={() => onSelectTag(tag)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="matched-notes-heading">
        <h2
          id="matched-notes-heading"
          className="text-[11px] font-semibold tracking-wide text-subtle-foreground uppercase"
        >
          Notas
        </h2>
        <div className="mt-3 overflow-hidden rounded-2xl border border-border">
          {searching || notes === null ? (
            <RowSkeleton rows={3} />
          ) : notes.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nada encontrado para{" "}
              <span className="text-foreground">“{query}”</span>. A busca também
              lê o conteúdo, não só o título.
            </p>
          ) : (
            <NoteList notes={notes} now={now} onOpenNote={onOpenNote} />
          )}
        </div>
      </section>
    </div>
  );
}

function NoteList({
  notes,
  now,
  onOpenNote,
}: {
  notes: RecentNote[];
  now: number;
  onOpenNote: (noteId: string) => void;
}) {
  return (
    <ul className="divide-y divide-border">
      {notes.map((note) => (
        <NoteRow
          key={note.id}
          note={note}
          now={now}
          onOpen={() => onOpenNote(note.id)}
        />
      ))}
    </ul>
  );
}

/**
 * Uma nota na lista. O clique abre no editor — a ação de sempre não pede
 * menu.
 */
function NoteRow({
  note,
  now,
  onOpen,
}: {
  note: RecentNote;
  now: number;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-secondary/40"
      >
        <NoteTypeIcon
          type={note.type}
          className="mt-0.5 size-4 shrink-0 text-subtle-foreground"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="min-w-0 flex-1 truncate text-sm text-foreground">
              {note.title}
            </p>
            <time
              dateTime={toIsoString(note.updatedAt)}
              title={formatAbsolute(note.updatedAt)}
              suppressHydrationWarning
              className="shrink-0 text-xs tabular-nums text-subtle-foreground"
            >
              {formatRelative(note.updatedAt, now)}
            </time>
          </div>

          {note.excerpt && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {note.excerpt}
            </p>
          )}

          {note.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {note.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    TAG_CHIP_CLASS[tagTone(tag)]
                  )}
                >
                  #{tag.name}
                </span>
              ))}
              {note.tags.length > 3 && (
                <span className="text-[11px] text-subtle-foreground">
                  +{note.tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </button>
    </li>
  );
}
