"use client";

import {
  ArrowLeft,
  GitFork,
  Hash,
  List,
  LoaderCircle,
  MoreHorizontal,
  Search,
  Tags as TagsIcon,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { NoteTypeIcon } from "@/components/dashboard/note-type-icon";
import { RowSkeleton } from "@/components/dashboard/panel";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ErrorReport } from "@/components/errors/error-report";
import { Input } from "@/components/ui/input";
import { type ApiFailure, readApiFailure } from "@/lib/api-failure";
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
import { cn, foldText } from "@/lib/utils";
import { SelectedTagHeader, type TagPatch } from "./tag-header";
import { TagMenuContent, useTagDeletion } from "./tag-menu";
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

type TagsViewMode = "list" | "graph" | "orphans";

/** Como cada modo aparece em `?modo=` — a lista é o padrão e não aparece. */
const MODE_PARAM: Record<TagsViewMode, string | null> = {
  list: null,
  graph: "grafo",
  orphans: "sem-notas",
};

function modeFromParam(param: string | null): TagsViewMode {
  return param === "grafo" ? "graph" : param === "sem-notas" ? "orphans" : "list";
}

/**
 * A tag aberta e o modo moram na URL (`?tag=<id>`, `?modo=grafo`,
 * `?modo=sem-notas`).
 *
 * Sem isso o "Voltar" do navegador saía da página em vez de fechar a tag,
 * voltar de uma nota perdia a tag que estava aberta, e não havia como
 * guardar ou mandar o link de uma tag. O `pushState` nativo se integra ao
 * roteador do Next (a página não recarrega nem refaz o fetch); o caminho de
 * volta é o `popstate`, que o componente escuta para reler a URL.
 *
 * Abrir, fechar e trocar de modo **empilham** uma entrada — cada um é um
 * lugar para onde o "Voltar" deve levar. Digitar na busca **substitui**:
 * cada letra não vira um degrau no histórico.
 */
function writeTagsUrl(
  tagId: string | null,
  view: TagsViewMode,
  mode: "push" | "replace"
) {
  const params = new URLSearchParams(window.location.search);
  if (tagId) params.set("tag", tagId);
  else params.delete("tag");
  const modeParam = MODE_PARAM[view];
  if (modeParam) params.set("modo", modeParam);
  else params.delete("modo");

  const search = params.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ""}`;
  if (url === `${window.location.pathname}${window.location.search}`) return;

  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

/**
 * Uma leitura que falhou não é uma lista vazia.
 *
 * Antes, erro de rede ou 5xx caía no mesmo ramo do "nada encontrado" — e a
 * tela dizia "Nenhuma nota com esta tag" para quem só tinha perdido a
 * conexão, que concluía que as notas tinham sumido. Agora a falha tem estado
 * próprio, com a mensagem do servidor e o "Tentar de novo".
 */
type Loaded<T> =
  | { status: "ok"; items: T }
  | { status: "failed"; failure: ApiFailure }
  /** 404 nas notas da tag: ela foi apagada em outro lugar. */
  | { status: "missing" };

const OFFLINE: ApiFailure = {
  message: "Sem conexão com o servidor. Confira a internet e tente de novo.",
  code: null,
};

export function TagsView({
  tags,
  renderedAt,
  initialTagId = null,
  initialView = "list",
}: {
  tags: TagWithUsage[];
  renderedAt: number;
  initialTagId?: string | null;
  initialView?: TagsViewMode;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // As tags moram em estado: renomear ou recolorir (aqui ou no grafo) precisa
  // chegar à lista, ao cabeçalho e ao grafo sem novo fetch.
  const [allTags, setAllTags] = useState(tags);

  function handleTagUpdated(tagId: string, patch: TagPatch) {
    setAllTags((current) =>
      current.map((tag) => (tag.id === tagId ? { ...tag, ...patch } : tag))
    );
    // Os chips das notas já listadas também mostram a tag.
    const patchNotes = (items: RecentNote[]) =>
      items.map((note) => ({
        ...note,
        tags: note.tags.map((tag) =>
          tag.id === tagId ? { ...tag, ...patch } : tag
        ),
      }));
    setTagNotes((current) =>
      current?.status === "ok"
        ? { ...current, items: patchNotes(current.items) }
        : current
    );
    setSearchResults((current) =>
      current?.status === "ok"
        ? { ...current, items: patchNotes(current.items) }
        : current
    );
    setGraphData((current) =>
      current && "tags" in current
        ? {
            ...current,
            tags: current.tags.map((tag) =>
              tag.id === tagId ? { ...tag, ...patch } : tag
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

  /**
   * Uma tag apagada (menu do chip no editor ou do nó no grafo) some da
   * lista, do grafo e do painel de notas da tag na hora — sem refetch, para
   * as posições dos nós que continuam vivos não se perderem.
   */
  function handleTagDeleted(tagId: string) {
    setAllTags((current) => current.filter((tag) => tag.id !== tagId));
    setGraphData((current) =>
      current && "tags" in current
        ? {
            ...current,
            tags: current.tags.filter((tag) => tag.id !== tagId),
            links: current.links.filter(
              (link) => link.source !== tagId && link.target !== tagId
            ),
          }
        : current
    );
    if (selectedId === tagId) writeTagsUrl(null, view, "replace");
    setSelectedId((current) => (current === tagId ? null : current));
    setTagNotes((current) => (current?.tagId === tagId ? null : current));
  }

  // O recado de uma ação que tirou algo da tela (apagar a tag) — confirmação,
  // não algo para dispensar, então some sozinho.
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Um só fluxo de apagar para a página inteira: o menu dos cartões e o
  // cabeçalho da tag aberta pedem pelo mesmo hook, com o mesmo diálogo.
  const deletion = useTagDeletion({
    onDeleted: (tagId) => {
      const name = allTags.find((tag) => tag.id === tagId)?.name;
      handleTagDeleted(tagId);
      setNotice(
        name
          ? `A tag “${name}” foi apagada — saiu de todas as notas que a usavam.`
          : "A tag foi apagada — saiu de todas as notas que a usavam."
      );
    },
  });

  // O menu do cartão pode pedir "renomear": abre a tag com o campo já ativo.
  // Vale só para a tag pedida e só na montagem do cabeçalho (ele tem `key`
  // pelo id), então não há flag para desligar depois.
  const [renameTagId, setRenameTagId] = useState<string | null>(null);

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
  // Guarda o id, não a tag: renomear ou recolorir muda `allTags`, e a tag
  // aberta lida de lá já nasce com o nome e a cor novos.
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    tags.some((tag) => tag.id === initialTagId) ? initialTagId : null
  );
  const selected = allTags.find((tag) => tag.id === selectedId) ?? null;
  const [view, setView] = useState<TagsViewMode>(initialView);

  // "Voltar" e "Avançar" do navegador: a URL já mudou, o estado acompanha.
  useEffect(() => {
    function syncFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const tagId = params.get("tag");
      setSelectedId(
        tagId && allTags.some((tag) => tag.id === tagId) ? tagId : null
      );
      setView(modeFromParam(params.get("modo")));
      setRenameTagId(null);
      setQuery("");
    }

    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [allTags]);
  const [graphData, setGraphData] = useState<
    TagGraph | { failure: ApiFailure } | null
  >(null);

  // O resultado carrega a busca que o originou (mesmo padrão da barra de
  // comando): “está buscando” é derivado, sem um segundo estado para zerar.
  const [searchResults, setSearchResults] = useState<
    ({ query: string } & Loaded<RecentNote[]>) | null
  >(null);
  const [tagNotes, setTagNotes] = useState<
    ({ tagId: string } & Loaded<RecentNote[]>) | null
  >(null);
  // "Tentar de novo" refaz a mesma leitura: o contador entra nas
  // dependências do efeito, que é quem sabe buscar.
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [notesAttempt, setNotesAttempt] = useState(0);

  /* --- Dados do grafo (sob demanda) --------------------------------------- */

  useEffect(() => {
    if (view !== "graph") return;
    if (graphData) return;

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/tags/graph");
        if (cancelled) return;
        if (!response.ok) {
          const failure = await readApiFailure(
            response,
            "Não foi possível carregar o grafo."
          );
          if (!cancelled) setGraphData({ failure });
          return;
        }
        const payload = await response.json();
        if (!cancelled) setGraphData(payload);
      } catch {
        if (!cancelled) setGraphData({ failure: OFFLINE });
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
          const failure = await readApiFailure(
            response,
            "Não foi possível buscar nas notas."
          );
          setSearchResults({ query: trimmed, status: "failed", failure });
          return;
        }
        const payload = await response.json();
        setSearchResults({
          query: trimmed,
          status: "ok",
          items: payload.notes ?? [],
        });
      } catch (error) {
        // Abort é o caso normal — uma busca mais nova cancelou esta.
        if ((error as Error)?.name !== "AbortError") {
          setSearchResults({ query: trimmed, status: "failed", failure: OFFLINE });
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, searchAttempt]);

  /* --- Notas da tag selecionada ----------------------------------------- */

  const notesAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!selectedId) {
      notesAbort.current?.abort();
      return;
    }

    notesAbort.current?.abort();
    const controller = new AbortController();
    notesAbort.current = controller;
    const tagId = selectedId;

    (async () => {
      try {
        const response = await fetch(`/api/tags/${tagId}/notes`, {
          signal: controller.signal,
        });
        if (response.status === 404) {
          setTagNotes({ tagId, status: "missing" });
          return;
        }
        if (!response.ok) {
          const failure = await readApiFailure(
            response,
            "Não foi possível carregar as notas desta tag."
          );
          setTagNotes({ tagId, status: "failed", failure });
          return;
        }
        const payload = await response.json();
        setTagNotes({ tagId, status: "ok", items: payload.notes ?? [] });
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") {
          setTagNotes({ tagId, status: "failed", failure: OFFLINE });
        }
      }
    })();

    return () => controller.abort();
  }, [selectedId, notesAttempt]);

  /* --- Estado derivado --------------------------------------------------- */

  const trimmedQuery = query.trim();
  const foldedQuery = foldText(trimmedQuery);
  // Filtrar tag no cliente custa nada — a lista já está aqui — e é o que
  // torna as tags antigas alcançáveis sem poluir a tela de descanso.
  const matchedTags = foldedQuery
    ? allTags.filter((tag) => foldText(tag.name).includes(foldedQuery))
    : [];

  // Tags sem notas ficam fora da lista e do grafo por padrão — elas não levam
  // a nada. A busca (`matchedTags`, acima) continua achando todas, e o modo
  // "sem notas" é onde a pessoa as revisa. Ver `lib/tags/orphans.ts`.
  const activeTags = allTags.filter((tag) => tag.noteCount > 0);
  const orphanTags = allTags.filter((tag) => tag.noteCount === 0);
  const orphanKey = orphanTags.map((tag) => tag.id).join(",");

  // O grafo compara as props por identidade para decidir se refaz o arranjo:
  // o filtro só gera um objeto novo quando os dados ou as órfãs mudam.
  const visibleGraph = useMemo(() => {
    if (!graphData || "failure" in graphData || !orphanKey) return graphData;
    const orphans = new Set(orphanKey.split(","));
    return {
      ...graphData,
      tags: graphData.tags.filter((tag) => !orphans.has(tag.id)),
      // A contagem da lista é da carga da página; o grafo veio depois. Uma
      // tag que ganhou nota nesse meio-tempo ainda conta como órfã aqui, e
      // uma aresta para um nó que não está no grafo derruba a simulação.
      links: graphData.links.filter((link) => !orphans.has(link.target)),
    };
  }, [graphData, orphanKey]);

  const currentSearch =
    searchResults?.query === trimmedQuery ? searchResults : null;
  const searching = trimmedQuery.length > 0 && currentSearch === null;

  const currentTagNotes =
    selected && tagNotes?.tagId === selected.id ? tagNotes : null;

  function retrySearch() {
    setSearchResults(null);
    setSearchAttempt((attempt) => attempt + 1);
  }

  function retryTagNotes() {
    setTagNotes(null);
    setNotesAttempt((attempt) => attempt + 1);
  }

  function selectTag(tag: TagWithUsage) {
    setSelectedId(tag.id);
    setRenameTagId(null);
    setQuery("");
    writeTagsUrl(tag.id, view, "push");
  }

  function changeView(next: TagsViewMode) {
    setView(next);
    writeTagsUrl(selectedId, next, "push");
  }

  /** Do grafo para a lista, já com a tag aberta — um passo só no histórico. */
  function openTagFromGraph(tagId: string) {
    if (!allTags.some((tag) => tag.id === tagId)) return;
    setView("list");
    setSelectedId(tagId);
    setRenameTagId(null);
    setQuery("");
    writeTagsUrl(tagId, "list", "push");
  }

  function handleOrphansPruned(deletedIds: string[], requested: number) {
    for (const tagId of deletedIds) handleTagDeleted(tagId);
    const kept = requested - deletedIds.length;
    const removed =
      deletedIds.length === 1
        ? "1 tag sem notas foi apagada."
        : `${deletedIds.length} tags sem notas foram apagadas.`;
    setNotice(
      kept > 0
        ? `${removed} ${kept === 1 ? "Uma ganhou nota" : `${kept} ganharam notas`} nesse meio-tempo e ficou.`
        : removed
    );
  }

  function requestRename(tag: TagWithUsage) {
    selectTag(tag);
    setRenameTagId(tag.id);
  }

  const openNote = (noteId: string) => router.push(`/nota/${noteId}`);

  const cardActions: TagCardActions = {
    onRename: requestRename,
    onDelete: (tag) => deletion.request(tag),
    onMenuOpen: (tag) => deletion.prime(tag),
  };

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
            {/* Um controle segmentado, não um botão que troca de rótulo: o
                modo atual fica à vista, em vez de ser deduzido pela ausência
                do outro. "Sem notas" é uma revisão dentro da lista. */}
            <div
              role="group"
              aria-label="Modo de exibição"
              className="ml-auto flex items-center rounded-lg bg-secondary p-0.5"
            >
              {(
                [
                  { mode: "list", label: "Lista", Icon: List },
                  { mode: "graph", label: "Grafo", Icon: GitFork },
                ] as const
              ).map(({ mode, label, Icon }) => {
                const active = mode === "graph" ? view === "graph" : view !== "graph";
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      if (view !== mode) changeView(mode);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors duration-150 pointer-coarse:py-2",
                      active
                        ? "bg-background text-foreground shadow-sm"
                        : "text-subtle-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
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
                if (selectedId) {
                  setSelectedId(null);
                  writeTagsUrl(null, view, "replace");
                }
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
                className="absolute top-1/2 right-3 flex size-7 -translate-y-1/2 pointer-coarse:size-10 items-center justify-center rounded-full text-subtle-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">Limpar busca</span>
              </button>
            )}
          </div>

          <div className="mt-10">
            {view === "graph" ? (
              <div className="space-y-3">
                {visibleGraph && "failure" in visibleGraph ? (
                  <div className="flex h-96 items-center justify-center rounded-2xl border border-border bg-secondary/40">
                    <LoadFailure
                      failure={visibleGraph.failure}
                      route="/api/tags/graph"
                      // Zerar o grafo é o que o efeito entende como "busque".
                      onRetry={() => setGraphData(null)}
                    />
                  </div>
                ) : visibleGraph ? (
                  <TagsGraph
                    {...visibleGraph}
                    searchQuery={trimmedQuery}
                    onOpenTag={openTagFromGraph}
                    onTagColorChange={(tagId, color) =>
                      handleTagUpdated(tagId, { color })
                    }
                    onNoteTagsEdited={() => void refreshGraph()}
                    onTagDeleted={handleTagDeleted}
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
                cardActions={cardActions}
                onRetry={retrySearch}
                onOpenNote={openNote}
              />
            ) : selected ? (
              <SelectedTagNotes
                tag={selected}
                notes={currentTagNotes}
                now={now}
                startRenaming={renameTagId === selected.id}
                onClear={() => {
                  setSelectedId(null);
                  writeTagsUrl(null, view, "push");
                }}
                onUpdated={handleTagUpdated}
                onDelete={() => deletion.request(selected)}
                onRetry={retryTagNotes}
                onMissing={() => handleTagDeleted(selected.id)}
                onOpenNote={openNote}
              />
            ) : view === "orphans" ? (
              <OrphanTags
                tags={orphanTags}
                onBack={() => changeView("list")}
                onSelectTag={selectTag}
                cardActions={cardActions}
                onPruned={handleOrphansPruned}
              />
            ) : (
              <RecentTags
                tags={activeTags}
                orphanCount={orphanTags.length}
                onShowOrphans={() => changeView("orphans")}
                onSelectTag={selectTag}
                cardActions={cardActions}
              />
            )}
          </div>
        </div>
      </main>

      {/* Fora da árvore que troca de ramo: o recado de "apagada" continua
          lido mesmo quando a tag aberta some e a lista volta. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
      >
        {notice && (
          <p className="max-w-md rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground shadow-[0_12px_32px_-12px_rgb(0_0_0/0.25)]">
            {notice}
          </p>
        )}
      </div>

      {deletion.dialog}
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
  orphanCount,
  onShowOrphans,
  onSelectTag,
  cardActions,
}: {
  tags: TagWithUsage[];
  /** Tags sem notas, fora desta lista — a linha do rodapé leva até elas. */
  orphanCount: number;
  onShowOrphans: () => void;
  onSelectTag: (tag: TagWithUsage) => void;
  cardActions: TagCardActions;
}) {
  const orphansLine =
    orphanCount > 0 ? (
      <p className="mt-2 text-xs text-subtle-foreground">
        {orphanCount === 1
          ? "1 tag sem notas ficou de fora da lista."
          : `${orphanCount} tags sem notas ficaram de fora da lista.`}{" "}
        <button
          type="button"
          onClick={onShowOrphans}
          className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          Revisar
        </button>
      </p>
    ) : null;

  if (tags.length === 0 && orphanCount > 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-8 py-12 text-center">
        <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-subtle-foreground">
          <TagsIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="max-w-[40ch]">
          <p className="text-sm font-medium text-foreground">
            Nenhuma tag marca notas agora
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {orphanCount === 1
              ? "A única tag da conta não está em nenhuma nota."
              : `As ${orphanCount} tags da conta não estão em nenhuma nota.`}{" "}
            <button
              type="button"
              onClick={onShowOrphans}
              className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              Revisar tags sem notas
            </button>
          </p>
        </div>
      </div>
    );
  }

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
            <TagCard
              tag={tag}
              onSelect={() => onSelectTag(tag)}
              actions={cardActions}
            />
          </li>
        ))}
      </ul>

      <div className="mt-4">
        {rest > 0 && (
          <p className="text-xs text-subtle-foreground">
            E mais {rest} {rest === 1 ? "tag" : "tags"} — aparecem na busca
            acima.
          </p>
        )}
        {orphansLine}
      </div>
    </section>
  );
}

/**
 * As tags sem notas, para revisar: abrir uma, renomear, apagar uma a uma
 * pelo menu — ou todas de uma vez.
 *
 * O "apagar todas" manda os ids **desta tela**, e o servidor só apaga as que
 * continuam sem notas (ver `DELETE /api/tags/orphans`). Nenhuma nota perde
 * tag com isso: por definição, nenhuma nota viva usava estas.
 */
function OrphanTags({
  tags,
  onBack,
  onSelectTag,
  cardActions,
  onPruned,
}: {
  tags: TagWithUsage[];
  onBack: () => void;
  onSelectTag: (tag: TagWithUsage) => void;
  cardActions: TagCardActions;
  onPruned: (deletedIds: string[], requested: number) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function prune() {
    const tagIds = tags.map((tag) => tag.id);
    setPruning(true);
    setFailure(null);
    try {
      const response = await fetch("/api/tags/orphans", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds }),
      });
      if (!response.ok) {
        setFailure(
          await readApiFailure(response, "Não foi possível apagar as tags.")
        );
        return;
      }
      const body = (await response.json()) as { deletedIds: string[] };
      setConfirming(false);
      onPruned(body.deletedIds, tagIds.length);
    } catch {
      setFailure(OFFLINE);
    } finally {
      setPruning(false);
    }
  }

  return (
    <section aria-labelledby="orphan-tags-heading">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 rounded-lg py-1 pr-2 text-sm text-subtle-foreground transition-colors duration-150 hover:text-foreground pointer-coarse:py-2.5"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Todas as tags
      </button>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id="orphan-tags-heading"
          className="text-lg font-semibold tracking-tight text-foreground"
        >
          Tags sem notas
        </h2>
        {tags.length > 0 && (
          <span className="text-xs tabular-nums text-subtle-foreground">
            {tags.length} {tags.length === 1 ? "tag" : "tags"}
          </span>
        )}
      </div>

      {tags.length === 0 ? (
        <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
          Nenhuma tag sobrando: todas marcam ao menos uma nota.
        </p>
      ) : (
        <>
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
            Nenhuma nota usa estas tags. Elas ficam fora da lista e do grafo,
            mas continuam aparecendo na busca. Apague as que não fazem mais
            falta — nenhuma nota perde nada com isso.
          </p>

          <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {tags.map((tag) => (
              <li key={tag.id}>
                <TagCard
                  tag={tag}
                  onSelect={() => onSelectTag(tag)}
                  actions={cardActions}
                />
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => {
              setFailure(null);
              setConfirming(true);
            }}
            className="mt-5 flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-foreground transition-colors duration-150 hover:border-error/40 hover:bg-error/10 hover:text-error pointer-coarse:h-11"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {tags.length === 1
              ? "Apagar esta tag"
              : `Apagar as ${tags.length} tags`}
          </button>

          <ConfirmDialog
            open={confirming}
            onOpenChange={(open) => {
              if (!pruning) setConfirming(open);
            }}
            title={
              tags.length === 1
                ? "Apagar a tag sem notas?"
                : `Apagar ${tags.length} tags sem notas?`
            }
            description="Nenhuma nota usa estas tags, então nenhuma nota muda. Se uma delas ganhou nota agora há pouco, ela fica."
            confirmLabel={failure ? "Tentar de novo" : "Apagar tags"}
            busyLabel="Apagando…"
            busy={pruning}
            error={failure?.message}
            onConfirm={() => void prune()}
          />
        </>
      )}
    </section>
  );
}

/** O que o menu de um cartão sabe fazer — o mesmo para lista e busca. */
interface TagCardActions {
  onRename: (tag: TagWithUsage) => void;
  onDelete: (tag: TagWithUsage) => void;
  /** O menu abriu: mede o impacto de apagar antes do clique. */
  onMenuOpen: (tag: TagWithUsage) => void;
}

/**
 * Um cartão de tag: cor, nome, quantas notas ela marca — e o menu dela.
 *
 * O menu é o mesmo `TagMenuContent` do chip no editor e do nó no grafo, e
 * abre de três jeitos: botão direito (ou a tecla de menu) no cartão, toque
 * longo, e o "⋯" sempre à vista. O "⋯" existe porque os dois primeiros são
 * invisíveis — quem não sabe que há um menu nunca o encontraria. Ele
 * dispara o mesmo `contextmenu` que o grafo usa para abrir o menu no ponto
 * certo, então não há um segundo tipo de menu para manter.
 */
function TagCard({
  tag,
  onSelect,
  actions,
}: {
  tag: TagWithUsage;
  onSelect: () => void;
  actions: TagCardActions;
}) {
  function openMenu(event: React.MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: rect.left,
        clientY: rect.bottom + 4,
      })
    );
  }

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) actions.onMenuOpen(tag);
      }}
    >
      <ContextMenuTrigger asChild>
        <div className="flex items-center rounded-xl border border-border transition-colors duration-150 hover:border-subtle-foreground/60 hover:bg-secondary/50 data-[state=open]:border-subtle-foreground/60 data-[state=open]:bg-secondary/50">
          <button
            type="button"
            onClick={onSelect}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-3 pr-2 pl-4 text-left"
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
              {tag.noteCount === 0
                ? "sem notas"
                : `${tag.noteCount} ${tag.noteCount === 1 ? "nota" : "notas"}`}
            </span>
          </button>
          <button
            type="button"
            onClick={openMenu}
            aria-haspopup="menu"
            aria-label={`Ações da tag ${tag.name}`}
            className="mr-1.5 grid size-8 shrink-0 place-items-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:size-11"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </div>
      </ContextMenuTrigger>

      <TagMenuContent
        tag={tag}
        editLabel="Renomear ou trocar a cor"
        onEdit={() => actions.onRename(tag)}
        onDelete={() => actions.onDelete(tag)}
      />
    </ContextMenu>
  );
}

/** As notas da tag aberta. */
function SelectedTagNotes({
  tag,
  notes,
  now,
  startRenaming,
  onClear,
  onUpdated,
  onDelete,
  onRetry,
  onMissing,
  onOpenNote,
}: {
  tag: TagWithUsage;
  notes: Loaded<RecentNote[]> | null;
  now: number;
  startRenaming: boolean;
  onClear: () => void;
  onUpdated: (tagId: string, patch: TagPatch) => void;
  onDelete: () => void;
  onRetry: () => void;
  /** A tag sumiu (apagada em outra aba): some da página também. */
  onMissing: () => void;
  onOpenNote: (noteId: string) => void;
}) {
  return (
    <section aria-labelledby="selected-tag-heading">
      <SelectedTagHeader
        // Outra tag é outro cabeçalho: um nome meio digitado não passa de uma
        // tag para a seguinte.
        key={tag.id}
        tag={tag}
        startRenaming={startRenaming}
        onBack={onClear}
        onUpdated={onUpdated}
        onDelete={onDelete}
      />

      <div className="mt-6 overflow-hidden rounded-2xl border border-border">
        {notes === null ? (
          <RowSkeleton rows={3} />
        ) : notes.status === "missing" ? (
          <div role="alert" className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <p className="text-sm text-foreground">
              Esta tag não existe mais — ela pode ter sido apagada em outra
              aba.
            </p>
            <button
              type="button"
              onClick={onMissing}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors duration-150 hover:bg-secondary"
            >
              Voltar para todas as tags
            </button>
          </div>
        ) : notes.status === "failed" ? (
          <LoadFailure
            failure={notes.failure}
            route="/api/tags/[tagId]/notes"
            onRetry={onRetry}
          />
        ) : notes.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhuma nota com esta tag.
          </p>
        ) : (
          <NoteList notes={notes.items} now={now} onOpenNote={onOpenNote} />
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
  cardActions,
  onRetry,
  onOpenNote,
}: {
  matchedTags: TagWithUsage[];
  notes: Loaded<RecentNote[]> | null;
  searching: boolean;
  query: string;
  now: number;
  onSelectTag: (tag: TagWithUsage) => void;
  cardActions: TagCardActions;
  onRetry: () => void;
  onOpenNote: (noteId: string) => void;
}) {
  const noteCount = notes?.status === "ok" ? notes.items.length : null;

  return (
    <div className="space-y-8">
      {/* O resultado muda enquanto se digita; quem não vê a lista ouve a
          contagem quando a busca assenta. */}
      <p role="status" className="sr-only">
        {searching || noteCount === null
          ? ""
          : `${matchedTags.length} ${matchedTags.length === 1 ? "tag" : "tags"} e ${noteCount} ${noteCount === 1 ? "nota" : "notas"} para “${query}”.`}
      </p>

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
                <TagCard
                  tag={tag}
                  onSelect={() => onSelectTag(tag)}
                  actions={cardActions}
                />
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
          ) : notes.status !== "ok" ? (
            <LoadFailure
              failure={notes.status === "failed" ? notes.failure : OFFLINE}
              route="/api/search"
              onRetry={onRetry}
            />
          ) : notes.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nada encontrado para{" "}
              <span className="text-foreground">“{query}”</span>. A busca também
              lê o conteúdo, não só o título.
            </p>
          ) : (
            <NoteList notes={notes.items} now={now} onOpenNote={onOpenNote} />
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Uma leitura que não veio: o que o servidor disse, o "Tentar de novo" e,
 * quando houve defeito de verdade (há código), o "Reportar".
 */
function LoadFailure({
  failure,
  route,
  onRetry,
}: {
  failure: ApiFailure;
  route: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 px-6 py-8 text-center"
    >
      <p className="max-w-[46ch] text-sm text-foreground">{failure.message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors duration-150 hover:bg-secondary"
      >
        Tentar de novo
      </button>
      {failure.code && <ErrorReport code={failure.code} route={route} compact />}
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
