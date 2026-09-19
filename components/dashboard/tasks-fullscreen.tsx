"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Coins,
  FileText,
  FolderTree,
  LoaderCircle,
  Pin,
  Sparkles,
  Tags,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  NOTE_TYPE_LABEL,
  NoteTypeIcon,
} from "@/components/dashboard/note-type-icon";
import { RowSkeleton } from "@/components/dashboard/panel";
import { ErrorReport } from "@/components/errors/error-report";
import {
  formatAbsolute,
  formatRelative,
  toIsoString,
} from "@/lib/dashboard/format";
import type {
  JobDetail,
  JobHistoryPage,
  JobKindFilter,
  JobStatusFilter,
} from "@/lib/dashboard/job-history";
import type { AiJobItem } from "@/lib/dashboard/queries";
import { storedChipClass } from "@/lib/tags/palette";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------- */
/* Vocabulário                                                             */
/* ---------------------------------------------------------------------- */

interface StatusStyle {
  icon: LucideIcon;
  tone: string;
  label: string;
  spin?: boolean;
}

/** O mesmo vocabulário do painel: a tela cheia é o painel ampliado, não outro objeto. */
const STATUS: Record<string, StatusStyle> = {
  queued: { icon: LoaderCircle, tone: "text-subtle-foreground", label: "Na fila" },
  waiting_configuration: {
    icon: CircleAlert,
    tone: "text-tag-1-foreground",
    label: "Aguardando IA",
  },
  running: {
    icon: LoaderCircle,
    tone: "text-tag-4-foreground",
    label: "Em andamento",
    spin: true,
  },
  succeeded: { icon: CircleCheck, tone: "text-tag-3-foreground", label: "Concluída" },
  failed: { icon: CircleAlert, tone: "text-error", label: "Falhou" },
  insufficient_credits: {
    icon: Coins,
    tone: "text-tag-1-foreground",
    label: "Sem créditos",
  },
};

const KIND: Record<string, { icon: LucideIcon; label: string }> = {
  summarize: { icon: Sparkles, label: "Leitura de nota" },
  classify: { icon: WandSparkles, label: "Upload" },
  transcribe: { icon: Sparkles, label: "Transcrição" },
  tag: { icon: Tags, label: "Marcação" },
  extract: { icon: FileText, label: "Extração" },
  organize: { icon: FolderTree, label: "Organização em pastas" },
};

const STATUS_FILTERS: { value: JobStatusFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "succeeded", label: "Concluídas" },
  { value: "failed", label: "Falharam" },
  { value: "active", label: "Em curso" },
];

const KIND_FILTERS: { value: JobKindFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "summarize", label: "Leitura de nota" },
  { value: "organize", label: "Organização em pastas" },
  { value: "classify", label: "Upload" },
  { value: "transcribe", label: "Transcrição" },
];

const numberFormat = new Intl.NumberFormat("pt-BR");
const secondsFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const dayFormat = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" });
const dayYearFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(ms, 0)} ms`;
  if (ms < 60_000) return `${secondsFormat.format(ms / 1000)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

function chars(value: number): string {
  return `${numberFormat.format(value)} caractere${value === 1 ? "" : "s"}`;
}

/** "Hoje", "Ontem", "12 de set." — no fuso de quem está olhando. */
function dayLabel(value: Date | string, now: number): string {
  const date = new Date(toIsoString(value));
  const today = new Date(now);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(date)) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return date.getFullYear() === today.getFullYear()
    ? dayFormat.format(date)
    : dayYearFormat.format(date);
}

type LoadedPage = { key: string | null; jobs: AiJobItem[]; cursor: string | null };

async function fetchHistoryPage(url: string, signal?: AbortSignal): Promise<JobHistoryPage> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as JobHistoryPage;
}

/** A cabeça nova sobre o que já estava carregado mais abaixo. */
function mergeHead(
  current: LoadedPage,
  fresh: JobHistoryPage,
  key: string,
  merge: boolean
): LoadedPage {
  if (!merge || current.key !== key || current.jobs.length <= fresh.jobs.length) {
    return { key, jobs: fresh.jobs, cursor: fresh.nextCursor };
  }
  const head = new Set(fresh.jobs.map((job) => job.id));
  const oldestHead = fresh.jobs[fresh.jobs.length - 1];
  const tail = current.jobs.filter(
    (job) =>
      !head.has(job.id) &&
      (!oldestHead ||
        new Date(toIsoString(job.createdAt)) <= new Date(toIsoString(oldestHead.createdAt)))
  );
  return { key, jobs: [...fresh.jobs, ...tail], cursor: current.cursor };
}

/** Uma media query como estado externo — sem efeito, sem `setState`. */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/* ---------------------------------------------------------------------- */
/* A tela cheia                                                            */
/* ---------------------------------------------------------------------- */

/**
 * Tarefas em tela cheia: o histórico inteiro, filtrável, com o detalhe de
 * cada requisição de IA — o que ela fez, com que modelo, em quanto tempo,
 * quanto texto leu, e por que falhou quando falhou.
 *
 * `<dialog>` nativo, pelo mesmo motivo da busca ampliada: top layer, backdrop
 * e foco preso sem biblioteca. Esc fecha e devolve o dashboard onde estava.
 *
 * **Vivo sem segundo canal.** O painel já assina `ai_jobs`; quando a lista
 * dele muda (`live`), esta tela rebusca a primeira página e o detalhe aberto.
 * As fixadas vêm prontas do painel.
 */
export function TasksFullscreen({
  open,
  onClose,
  pinned,
  live,
  now,
}: {
  open: boolean;
  onClose: () => void;
  /** As fixadas, direto do painel — já vivas. */
  pinned: AiJobItem[];
  /** A lista viva do painel. Muda de identidade a cada evento do Realtime. */
  live: AiJobItem[];
  now: number;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const [statusFilter, setStatusFilter] = useState<JobStatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<JobKindFilter>("all");
  const filterKey = `${statusFilter}|${kindFilter}`;
  // A página carregada, marcada com os filtros que a pediram. Enquanto a
  // chave não bate com a atual, a lista está carregando — derivado, sem
  // estado de "carregando" para manter em sincronia.
  const [page, setPage] = useState<LoadedPage>({ key: null, jobs: [], cursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  // No celular o detalhe ocupa a tela; no desktop fica ao lado.
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // O foco começa na tarefa da vez, como a busca ampliada começa no
      // campo. Sem linhas ainda, fica o padrão do diálogo.
      window.requestAnimationFrame(() =>
        dialog.querySelector<HTMLButtonElement>('[data-job-id][tabindex="0"]')?.focus()
      );
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const pageUrl = useCallback(
    (after: string | null) => {
      const params = new URLSearchParams({ status: statusFilter, kind: kindFilter });
      if (after) params.set("cursor", after);
      return `/api/jobs/history?${params}`;
    },
    [statusFilter, kindFilter]
  );

  const loadMore = useCallback(async () => {
    if (!page.cursor || loadingMore || page.key !== filterKey) return;
    setLoadingMore(true);
    try {
      const response = await fetch(pageUrl(page.cursor), { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as JobHistoryPage;
      setPage((current) => {
        if (current.key !== filterKey) return current;
        const seen = new Set(current.jobs.map((job) => job.id));
        return {
          key: current.key,
          jobs: [...current.jobs, ...next.jobs.filter((job) => !seen.has(job.id))],
          cursor: next.nextCursor,
        };
      });
    } catch {
      setFailedKey(filterKey);
    } finally {
      setLoadingMore(false);
    }
  }, [page, loadingMore, filterKey, pageUrl]);

  /**
   * Busca a primeira página e grava — todo estado **depois** da resposta.
   * `merge` (evento do Realtime) mantém o que a pessoa já rolou para ver;
   * sem ele, recomeça.
   */
  const refreshHead = useCallback(
    (merge: boolean) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const key = filterKey;
      void (async () => {
        try {
          const fresh = await fetchHistoryPage(pageUrl(null), controller.signal);
          setFailedKey(null);
          setPage((current) => mergeHead(current, fresh, key, merge));
        } catch (error) {
          if ((error as Error).name !== "AbortError") setFailedKey(key);
        } finally {
          if (request.current === controller) request.current = null;
        }
      })();
    },
    [filterKey, pageUrl]
  );

  // Abrir ou trocar de filtro recomeça do topo; um evento do Realtime (a
  // lista viva do painel mudou) atualiza a cabeça sem perder o que já foi
  // rolado.
  const lastLive = useRef(live);
  useEffect(() => {
    if (!open) return;
    const merge = lastLive.current !== live;
    lastLive.current = live;
    refreshHead(merge);
  }, [open, live, refreshHead]);

  const history = useMemo(
    () => (page.key === filterKey ? page.jobs : []),
    [page, filterKey]
  );
  const cursor = page.key === filterKey ? page.cursor : null;
  const listFailed = failedKey === filterKey;
  const firstLoading = open && page.key !== filterKey && !listFailed;

  // Rolar até o fim carrega mais — com botão de reserva para quem não rola.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "240px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  const visiblePinned = useMemo(
    () =>
      pinned.filter(
        (job) =>
          (kindFilter === "all" || job.kind === kindFilter) &&
          (statusFilter === "all" || statusFilter === "active")
      ),
    [pinned, kindFilter, statusFilter]
  );

  const ordered = useMemo(() => [...visiblePinned, ...history], [visiblePinned, history]);

  // No desktop a tela nunca começa com metade vazia: sem escolha, o detalhe
  // mostra a primeira tarefa. No celular a lista vem primeiro.
  const selectedId =
    chosenId && ordered.some((job) => job.id === chosenId)
      ? chosenId
      : isDesktop
        ? (ordered[0]?.id ?? null)
        : chosenId;

  const groups = useMemo(() => {
    const result: { day: string; jobs: AiJobItem[] }[] = [];
    for (const job of history) {
      const day = dayLabel(job.createdAt, now);
      const last = result[result.length - 1];
      if (last && last.day === day) last.jobs.push(job);
      else result.push({ day, jobs: [job] });
    }
    return result;
  }, [history, now]);

  // Reabrir começa pela lista: no celular, cair direto num detalhe velho
  // esconderia os filtros e a faixa fixada.
  function close() {
    setShowDetailOnMobile(false);
    onClose();
  }

  const backRef = useRef<HTMLButtonElement>(null);

  function select(id: string) {
    setChosenId(id);
    setShowDetailOnMobile(true);
    // No celular a linha clicada some atrás do detalhe: o foco segue para o
    // detalhe em vez de cair no <body>.
    if (!isDesktop) window.requestAnimationFrame(() => backRef.current?.focus());
  }

  function backToList() {
    setShowDetailOnMobile(false);
    const id = selectedId;
    window.requestAnimationFrame(() =>
      dialogRef.current
        ?.querySelector<HTMLButtonElement>(`[data-job-id="${id}"]`)
        ?.focus()
    );
  }

  // Setas percorrem a lista, como numa caixa de correio.
  function handleListKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const index = ordered.findIndex((job) => job.id === selectedId);
    const next =
      event.key === "ArrowDown"
        ? Math.min(index + 1, ordered.length - 1)
        : Math.max(index - 1, 0);
    const job = ordered[next];
    if (!job) return;
    event.preventDefault();
    setChosenId(job.id);
    const button = event.currentTarget.querySelector<HTMLButtonElement>(
      `[data-job-id="${job.id}"]`
    );
    button?.focus();
    button?.scrollIntoView({ block: "nearest" });
  }

  const empty = !firstLoading && !listFailed && ordered.length === 0;
  // Uma parada de Tab para a lista inteira; as setas andam dentro dela.
  const tabbableId = selectedId ?? ordered[0]?.id ?? null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-description`}
      onClose={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-0 text-foreground backdrop:bg-black/35 backdrop:backdrop-blur-[3px] sm:m-auto sm:h-[calc(100dvh-2rem)] sm:w-[min(84rem,calc(100%-2rem))]"
    >
      {open && (
        <div className="flex h-full animate-sheet-open flex-col overflow-hidden bg-background motion-reduce:animate-none sm:rounded-2xl sm:border sm:border-border sm:shadow-[0_24px_80px_-28px] sm:shadow-black/50">
          <header className="flex shrink-0 items-start gap-4 border-b border-border px-4 py-3.5 sm:px-6 sm:py-4">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                Tarefas
              </h2>
              <p id={`${titleId}-description`} className="mt-0.5 text-sm text-muted-foreground">
                Tudo o que a Nexo leu, classificou e transcreveu — e como.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="flex size-9 shrink-0 items-center justify-center rounded-xl text-subtle-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground pointer-coarse:size-11"
            >
              <X className="size-[18px]" aria-hidden="true" />
              <span className="sr-only">Fechar a tela cheia de Tarefas</span>
            </button>
          </header>

          <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(19rem,25rem)_minmax(0,1fr)]">
            {/* A lista */}
            <div
              className={cn(
                "flex min-h-0 flex-col border-border md:border-r",
                showDetailOnMobile && "max-md:hidden"
              )}
            >
              <div
                role="toolbar"
                aria-label="Filtrar tarefas"
                className="shrink-0 space-y-2 border-b border-border px-4 py-3"
              >
                <FilterGroup
                  primary
                  label="Situação"
                  options={STATUS_FILTERS}
                  value={statusFilter}
                  onChange={(value) => {
                    setStatusFilter(value);
                    setChosenId(null);
                  }}
                />
                <FilterGroup
                  label="Tipo"
                  options={KIND_FILTERS}
                  value={kindFilter}
                  onChange={(value) => {
                    setKindFilter(value);
                    setChosenId(null);
                  }}
                />
              </div>

              <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                onKeyDown={handleListKeys}
              >
                {firstLoading && visiblePinned.length === 0 ? (
                  <RowSkeleton rows={6} />
                ) : empty ? (
                  <p className="px-6 py-12 text-center text-sm leading-relaxed text-muted-foreground">
                    {statusFilter === "all" && kindFilter === "all"
                      ? "Nenhuma tarefa ainda. Envie um arquivo ou escreva uma nota — cada leitura da Nexo aparece aqui."
                      : "Nenhuma tarefa com esses filtros."}
                  </p>
                ) : (
                  <>
                    {visiblePinned.length > 0 && (
                      <section aria-label="Fixadas" className="border-b border-border bg-tag-1/60">
                        <h3 className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-xs font-semibold text-muted-foreground">
                          <Pin className="size-3 text-tag-1-foreground" aria-hidden="true" />
                          Fixado até acontecer
                        </h3>
                        <ul>
                          {visiblePinned.map((job) => (
                            <ListRow
                              key={job.id}
                              job={job}
                              now={now}
                              selected={job.id === selectedId}
                              tabbable={job.id === tabbableId}
                              onSelect={select}
                              pinned
                            />
                          ))}
                        </ul>
                      </section>
                    )}

                    {groups.map((group) => (
                      <section key={group.day} aria-label={group.day}>
                        <h3 className="sticky top-0 z-[1] border-b border-border bg-background/95 px-4 py-1.5 text-xs font-medium text-subtle-foreground backdrop-blur-sm">
                          {group.day}
                        </h3>
                        <ul>
                          {group.jobs.map((job) => (
                            <ListRow
                              key={job.id}
                              job={job}
                              now={now}
                              selected={job.id === selectedId}
                              tabbable={job.id === tabbableId}
                              onSelect={select}
                            />
                          ))}
                        </ul>
                      </section>
                    ))}

                    <div ref={sentinel} className="px-4 py-4 text-center">
                      {listFailed ? (
                        <button
                          type="button"
                          onClick={() => (history.length ? void loadMore() : refreshHead(false))}
                          className="text-sm font-medium text-error underline underline-offset-4"
                        >
                          Não carregou. Tentar de novo
                        </button>
                      ) : loadingMore || firstLoading ? (
                        <LoaderCircle
                          className="mx-auto size-4 animate-spin text-subtle-foreground motion-reduce:animate-none"
                          aria-label="Carregando mais tarefas"
                        />
                      ) : cursor ? (
                        <button
                          type="button"
                          onClick={() => void loadMore()}
                          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
                        >
                          Carregar mais
                        </button>
                      ) : history.length > 0 ? (
                        <p className="text-xs text-subtle-foreground">
                          Isso é tudo — do começo da conta até aqui.
                        </p>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* O detalhe */}
            <div
              className={cn(
                "min-h-0 overflow-y-auto overscroll-contain",
                !showDetailOnMobile && "max-md:hidden"
              )}
            >
              <button
                ref={backRef}
                type="button"
                onClick={backToList}
                className="sticky top-0 z-[1] flex h-11 w-full items-center gap-2 border-b border-border bg-background/95 px-4 text-sm text-muted-foreground backdrop-blur-sm md:hidden"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Todas as tarefas
              </button>

              {selectedId ? (
                <DetailPane key={selectedId} jobId={selectedId} live={live} now={now} />
              ) : (
                <p className="px-8 py-16 text-center text-sm text-muted-foreground max-md:hidden">
                  Escolha uma tarefa para ver o que a Nexo fez.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

/* ---------------------------------------------------------------------- */

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  primary,
}: {
  label: string;
  /** Só um grupo leva o realce cheio: dois pretos lado a lado leem como o
   *  mesmo controle repetido. */
  primary?: boolean;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      <span aria-hidden="true" className="w-16 shrink-0 text-xs text-subtle-foreground">
        {label}
      </span>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150 pointer-coarse:h-9 pointer-coarse:py-0",
              active
                ? primary
                  ? "bg-foreground text-background"
                  : "bg-secondary text-foreground ring-1 ring-border"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ListRow({
  job,
  now,
  selected,
  tabbable,
  onSelect,
  pinned,
}: {
  job: AiJobItem;
  now: number;
  selected: boolean;
  tabbable: boolean;
  onSelect: (id: string) => void;
  pinned?: boolean;
}) {
  const state = STATUS[job.status] ?? STATUS.queued;
  const StatusIcon = state.icon;
  const kind = KIND[job.kind];
  const timestamp = job.finishedAt ?? job.createdAt;

  return (
    <li>
      <button
        type="button"
        data-job-id={job.id}
        tabIndex={tabbable ? 0 : -1}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(job.id)}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150",
          selected
            ? pinned
              ? "bg-tag-1-foreground/10"
              : "bg-secondary"
            : pinned
              ? "hover:bg-tag-1-foreground/5"
              : "hover:bg-secondary/50"
        )}
      >
        <span className={cn("mt-0.5 shrink-0", state.tone)}>
          <StatusIcon
            className={cn("size-4", state.spin && "animate-spin motion-reduce:animate-none")}
            aria-hidden="true"
          />
          <span className="sr-only">{state.label}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                selected ? "font-medium text-foreground" : "text-foreground"
              )}
            >
              {job.label}
            </span>
            <time
              dateTime={toIsoString(timestamp)}
              suppressHydrationWarning
              className="shrink-0 text-xs tabular-nums text-subtle-foreground"
            >
              {formatRelative(timestamp, now)}
            </time>
          </span>
          <span className="mt-0.5 block text-xs text-subtle-foreground">
            {kind?.label ?? job.kind} · {state.label}
          </span>
        </span>
      </button>
    </li>
  );
}

/* ---------------------------------------------------------------------- */
/* O detalhe                                                               */
/* ---------------------------------------------------------------------- */

function DetailPane({
  jobId,
  live,
  now,
}: {
  jobId: string;
  live: AiJobItem[];
  now: number;
}) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [failed, setFailed] = useState(false);

  // A tarefa selecionada, como o painel a vê agora. Quando ela muda de
  // estado (na fila → lendo → concluída), o detalhe rebusca.
  const liveStamp = useMemo(() => {
    const row = live.find((item) => item.id === jobId);
    return row ? `${row.status}|${toIsoString(row.finishedAt ?? row.createdAt)}` : "";
  }, [live, jobId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { job: JobDetail };
        setJob(body.job);
        setFailed(false);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [jobId, liveStamp]);

  if (failed) {
    return (
      <p className="px-8 py-16 text-center text-sm text-muted-foreground">
        Não foi possível carregar esta tarefa. Ela pode ter sido excluída.
      </p>
    );
  }

  if (!job || job.id !== jobId) return <DetailSkeleton />;

  const state = STATUS[job.status] ?? STATUS.queued;
  const StatusIcon = state.icon;
  const kind = KIND[job.kind];
  const KindIcon = kind?.icon ?? WandSparkles;
  const isReading = job.kind === "summarize";

  const facts: { term: string; value: ReactNode }[] = [];
  if (job.provider || job.model) {
    facts.push({
      term: job.kind === "transcribe" ? "Transcrição" : "Modelo",
      value: <Mono>{[job.provider, job.model].filter(Boolean).join(" · ")}</Mono>,
    });
  }
  if (job.classifyProvider || job.classifyModel) {
    facts.push({
      term: "Classificação",
      value: <Mono>{[job.classifyProvider, job.classifyModel].filter(Boolean).join(" · ")}</Mono>,
    });
  }
  if (job.durationMs !== null) {
    facts.push({ term: "Duração", value: formatDuration(job.durationMs) });
  }
  if (job.inputChars !== null) {
    facts.push({
      term: "Texto lido",
      value:
        job.truncated && job.noteChars !== null
          ? `${chars(job.inputChars)} de ${numberFormat.format(job.noteChars)} — começo e fim`
          : chars(job.inputChars),
    });
  }
  if (job.transcriptChars !== null) {
    facts.push({ term: "Transcrito", value: chars(job.transcriptChars) });
  }
  if (job.reused) {
    facts.push({ term: "Tokens", value: "Nenhum — leitura reaproveitada de outra nota" });
  } else if (job.tokens) {
    const { prompt, completion, reasoning } = job.tokens;
    facts.push({
      term: "Tokens",
      value: `${job.batchSize ? "~" : ""}${numberFormat.format(prompt)} de entrada · ${numberFormat.format(completion)} de saída${
        reasoning ? ` (${numberFormat.format(reasoning)} pensando)` : ""
      }`,
    });
  }
  if (job.batchSize) {
    facts.push({
      term: "Lote",
      value: `Lida junto com mais ${job.batchSize - 1} ${
        job.batchSize === 2 ? "nota" : "notas"
      } numa chamada só; os tokens são a parte desta`,
    });
  }
  if (job.attempt !== null) {
    facts.push({ term: "Tentativa", value: `${job.attempt}ª` });
  }
  facts.push({
    term: "Pedida",
    value: (
      <time dateTime={job.createdAt} title={formatAbsolute(job.createdAt)}>
        {formatAbsolute(job.createdAt)}
      </time>
    ),
  });
  if (job.finishedAt) {
    facts.push({
      term: "Terminou",
      value: (
        <time dateTime={job.finishedAt} title={formatAbsolute(job.finishedAt)}>
          {formatRelative(job.finishedAt, now)}
        </time>
      ),
    });
  }

  return (
    <article
      key={job.id}
      aria-labelledby={`job-${job.id}`}
      className="w-full max-w-2xl animate-row-in px-5 pt-4 pb-10 motion-reduce:animate-none sm:px-8 md:px-10 md:pt-8"
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle-foreground">
        <span className={cn("inline-flex items-center gap-1.5 font-medium", state.tone)}>
          <StatusIcon
            className={cn("size-3.5", state.spin && "animate-spin motion-reduce:animate-none")}
            aria-hidden="true"
          />
          {state.label}
        </span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1.5">
          <KindIcon className="size-3.5" aria-hidden="true" />
          {kind?.label ?? job.kind}
        </span>
      </p>

      <h3
        id={`job-${job.id}`}
        className="mt-2 text-xl font-semibold tracking-[-0.01em] text-balance text-foreground"
      >
        {job.label}
      </h3>

      {job.detail && (
        <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-pretty text-muted-foreground">
          {job.detail}
        </p>
      )}

      {isReading && job.status === "queued" && (
        <p className="mt-5 max-w-[62ch] rounded-xl bg-tag-1/60 px-4 py-3 text-sm leading-relaxed text-pretty text-foreground">
          Fica fixada até a leitura começar. A Nexo lê quando você para de
          escrever ou sai da nota — e, se a aba fechou antes, na próxima vez
          que você abrir o dashboard. Nada do que você escreveu se perde.
        </p>
      )}

      {job.status === "failed" && job.errorCode && (
        <div className="mt-5">
          <ErrorReport code={job.errorCode} route={`/api/jobs/${job.id}`} compact />
        </div>
      )}

      {/* O que a Nexo produziu */}
      {(job.summary || job.summarized || job.tags.length > 0 || job.typeSuggested) && (
        <div className="mt-8 space-y-7">
          {job.summary ? (
            <DetailBlock
              title="Resumo"
              aside={job.summary.stale ? "de uma versão anterior da nota" : "o atual da nota"}
            >
              <p className="rounded-xl bg-secondary/60 px-4 py-3 text-sm leading-relaxed text-pretty text-foreground">
                {job.summary.text}
              </p>
              {job.summaryKept && (
                <p className="mt-2 max-w-[62ch] text-xs leading-relaxed text-pretty text-subtle-foreground">
                  Esta leitura só marcou: a nota mudou pouco desde o resumo para
                  valer reescrevê-lo. Para reescrever agora, use “Reler e
                  organizar” em Notas.
                </p>
              )}
            </DetailBlock>
          ) : job.summarized ? (
            <DetailBlock title="Resumo">
              <p className="text-sm text-muted-foreground">
                {job.summaryChars ? `${chars(job.summaryChars)}, ` : ""}
                guardado embaixo da nota.
              </p>
            </DetailBlock>
          ) : isReading && job.status === "succeeded" ? (
            <DetailBlock title="Resumo">
              <p className="text-sm text-muted-foreground">
                Nota curta demais para resumir — a Nexo só marcou.
              </p>
            </DetailBlock>
          ) : null}

          {job.status === "succeeded" && job.kind !== "organize" && (
            <DetailBlock title="Tags">
              {job.tags.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {job.tags.map((tag) => (
                    <li
                      key={tag.name}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                        storedChipClass(tag)
                      )}
                    >
                      {tag.name}
                      {tag.created && (
                        <span className="rounded-full bg-background/60 px-1.5 text-[10px] font-semibold">
                          nova
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma tag nova — as que a nota já tinha bastaram.
                </p>
              )}
              {isReading && job.tags.some((tag) => !tag.created) && (
                <p className="mt-2 text-xs text-subtle-foreground">
                  Sem “nova”: reaproveitada das suas tags.
                </p>
              )}
            </DetailBlock>
          )}

          {job.typeSuggested && (
            <DetailBlock title={isReading ? "Tipo sugerido" : "Tipo"}>
              <p className="inline-flex items-center gap-2 text-sm text-foreground">
                <NoteTypeIcon type={job.typeSuggested} className="size-4 text-subtle-foreground" />
                {NOTE_TYPE_LABEL[job.typeSuggested] ?? job.typeSuggested}
              </p>
              {isReading && (
                <p className="mt-1 text-xs text-subtle-foreground">
                  Sugestão. O tipo da nota continua o que você escolheu.
                </p>
              )}
            </DetailBlock>
          )}
        </div>
      )}

      {job.organize && <OrganizeResult result={job.organize} />}

      <DetailBlock title="A requisição" className="mt-8">
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
          {facts.map((fact) => (
            <div key={fact.term} className="contents">
              <dt className="text-subtle-foreground">{fact.term}</dt>
              <dd className="min-w-0 text-foreground tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </DetailBlock>

      {job.note && (
        <div className="mt-8 border-t border-border pt-5">
          {job.note.available ? (
            <Link
              href={`/nota/${job.note.id}`}
              className="inline-flex h-9 max-w-full items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground transition-colors duration-150 hover:bg-accent/90 pointer-coarse:h-11"
            >
              <span className="truncate">Abrir “{job.note.title}”</span>
              <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">A nota desta tarefa foi excluída.</p>
          )}
        </div>
      )}
    </article>
  );
}

function OrganizeResult({ result }: { result: NonNullable<JobDetail["organize"]> }) {
  const created = new Set(result.created);
  const folders = [...new Set([...result.created, ...result.used])];
  return (
    <div className="mt-8 space-y-7">
      <DetailBlock title="Pastas" aside={`${result.considered} ${result.considered === 1 ? "nota considerada" : "notas consideradas"}`}>
        {folders.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {folders.map((name) => (
              <li
                key={name}
                className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground"
              >
                <FolderTree className="size-3.5 text-subtle-foreground" aria-hidden="true" />
                {name}
                {created.has(name) && (
                  <span className="rounded-full bg-background/70 px-1.5 text-[10px] font-semibold">
                    nova
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma nota combinou com uma pasta.</p>
        )}
        <p className="mt-2 text-xs text-subtle-foreground">
          {result.placed} {result.placed === 1 ? "posta" : "postas"} numa pasta
          {result.moved ? ` · ${result.moved} ${result.moved === 1 ? "mudou" : "mudaram"} de pasta` : ""}.
          As notas que você pôs numa pasta ficam onde estão.
        </p>
      </DetailBlock>
      <Link
        href="/dashboard/notas"
        className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-secondary pointer-coarse:h-11"
      >
        Ver as pastas em Notas
        <ArrowUpRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

function DetailBlock({
  title,
  aside,
  className,
  children,
}: {
  title: string;
  aside?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className}>
      <h4 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-foreground">
        {title}
        {aside && <span className="text-xs font-normal text-subtle-foreground">{aside}</span>}
      </h4>
      {children}
    </section>
  );
}

/** Nome de modelo é identificador: lê-se caractere a caractere. */
function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] break-all">{children}</span>;
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" className="w-full max-w-2xl space-y-4 px-5 pt-8 sm:px-8 md:px-10">
      <span className="sr-only">Carregando a tarefa</span>
      <span className="block h-3 w-32 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
      <span className="block h-6 w-3/4 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
      <span className="block h-3 w-2/3 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
      <span className="mt-8 block h-20 w-full animate-pulse rounded-xl bg-secondary motion-reduce:animate-none" />
    </div>
  );
}
