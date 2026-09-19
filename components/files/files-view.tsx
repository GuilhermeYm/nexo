"use client";

import {
  ArrowDownAZ,
  ArrowLeft,
  ChevronDown,
  Download,
  File,
  FileAudio,
  FileText,
  FileType2,
  ImageIcon,
  LoaderCircle,
  Music2,
  Paperclip,
  Search,
  Trash2,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { FileViewerDialog } from "@/components/files/file-viewer-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { readApiFailure } from "@/lib/api-failure";
import {
  ATTACHMENT_TYPES,
  type AttachmentListItem,
  type AttachmentListResult,
  type AttachmentListSort,
  type AttachmentListType,
} from "@/lib/attachments/list";
import { formatRelative } from "@/lib/dashboard/format";
import { formatBytes } from "@/lib/utils";
import { cn } from "@/lib/utils";

const SEARCH_DELAY_MS = 250;

const EMPTY_ATTACHMENT_LIST: AttachmentListResult = {
  attachments: [],
  total: 0,
  page: 1,
  pageSize: 24,
  hasMore: false,
};

const TYPE_LABEL: Record<AttachmentListType, string> = {
  image: "Imagens",
  audio: "Áudios",
  video: "Vídeos",
  pdf: "PDFs",
  document: "Documentos",
  other: "Outros",
};

const SORT_OPTIONS: { value: AttachmentListSort; label: string }[] = [
  { value: "newest", label: "Enviados recentemente" },
  { value: "name", label: "Nome de A a Z" },
  { value: "size", label: "Maior tamanho" },
];

export function FilesView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const firstRequest = useRef(true);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<AttachmentListType | "all">("all");
  const [sort, setSort] = useState<AttachmentListSort>("newest");
  const [result, setResult] = useState(EMPTY_ATTACHMENT_LIST);
  const [status, setStatus] = useState<"loading" | "idle" | "more" | "error">(
    "loading"
  );
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false);
  // O relógio das datas relativas: lido fora do render (regra de pureza do
  // React) e avançado a cada minuto.
  const [now, setNow] = useState(() => Date.now());
  const [opened, setOpened] = useState<AttachmentListItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AttachmentListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (firstRequest.current) {
      firstRequest.current = false;
      void loadPage(1, false);
      return;
    }

    const timer = setTimeout(
      () => void loadPage(1, false),
      query.trim() ? SEARCH_DELAY_MS : 0
    );
    return () => clearTimeout(timer);
    // `loadPage` lê os controles atuais; estes são os únicos gatilhos de busca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, type, sort]);

  async function loadPage(page: number, append: boolean) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus(append ? "more" : "loading");

    const params = new URLSearchParams({
      q: query.trim(),
      type,
      sort,
      page: String(page),
    });

    try {
      const response = await fetch(`/api/attachments?${params}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("attachment inventory request failed");
      const next: AttachmentListResult = await response.json();
      if (controller.signal.aborted) return;

      setResult((current) => ({
        ...next,
        attachments: append
          ? [...current.attachments, ...next.attachments]
          : next.attachments,
      }));
      setHasLoadedInitial(true);
      setStatus("idle");
    } catch (error) {
      if ((error as Error).name !== "AbortError") setStatus("error");
    }
  }

  const filtered = query.trim() || type !== "all";

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/attachments/${target.id}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        const failure = await readApiFailure(response, "Não foi possível apagar o arquivo.");
        setDeleteError(
          failure.code ? `${failure.message} (${failure.code})` : failure.message
        );
        return;
      }
      // 404 também tira da lista: outro aparelho já tinha apagado.
      setResult((current) => ({
        ...current,
        attachments: current.attachments.filter((item) => item.id !== target.id),
        total: Math.max(0, current.total - 1),
      }));
      setPendingDelete(null);
      setAnnouncement(`${target.filename} foi apagado.`);
    } catch {
      setDeleteError("Sem conexão. O arquivo continua guardado — tente de novo.");
    } finally {
      setDeleting(false);
    }
  }

  function clearFilters() {
    setQuery("");
    setType("all");
    setSort("newest");
    inputRef.current?.focus();
  }

  return (
    <div className="flex min-h-dvh bg-secondary p-2 sm:p-3">
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-background">
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-8 sm:px-7 sm:py-12 lg:px-10">
          <Link
            href="/dashboard"
            className="flex w-fit items-center gap-1.5 rounded-lg py-1 pr-2 text-sm text-subtle-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Início
          </Link>

          <header className="mt-6 flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-[0_8px_18px_-12px_color-mix(in_oklab,var(--accent)_65%,transparent)]">
                  <Paperclip className="size-5" aria-hidden="true" />
                </span>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[30px]">
                  Arquivos
                </h1>
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Cada arquivo que você enviou fica guardado aqui, pronto para
                voltar à sua nota ou à lousa quando precisar.
              </p>
            </div>
            <p
              aria-live="polite"
              className="shrink-0 text-sm tabular-nums text-subtle-foreground"
            >
              {status === "loading"
                ? hasLoadedInitial
                  ? "Atualizando…"
                  : "Buscando no servidor…"
                : `${result.total} ${result.total === 1 ? "arquivo" : "arquivos"}`}
            </p>
          </header>

          <section aria-label="Filtros de arquivos" className="mt-7">
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
                  if (event.key !== "Escape") return;
                  if (query) setQuery("");
                  else inputRef.current?.blur();
                }}
                placeholder="Buscar pelo nome do arquivo…"
                aria-label="Buscar arquivos"
                className="h-12 pr-11 pl-11 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  className="absolute top-1/2 right-3 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <X className="size-4" aria-hidden="true" />
                  <span className="sr-only">Limpar busca</span>
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div
                className="flex w-full gap-1 overflow-x-auto rounded-xl bg-secondary p-1 sm:w-fit"
                aria-label="Filtrar por formato"
              >
                <FilterButton active={type === "all"} onClick={() => setType("all")}>
                  Todos
                </FilterButton>
                {ATTACHMENT_TYPES.map((value) => (
                  <FilterButton
                    key={value}
                    active={type === value}
                    onClick={() => setType(value)}
                  >
                    {TYPE_LABEL[value]}
                  </FilterButton>
                ))}
              </div>

              <SelectControl
                label="Ordenar arquivos"
                value={sort}
                onChange={(value) => setSort(value as AttachmentListSort)}
                options={SORT_OPTIONS}
                icon={sort === "name" ? ArrowDownAZ : undefined}
              />
            </div>
          </section>

          <section
            className="mt-8 flex flex-1 flex-col"
            aria-busy={status === "loading"}
          >
            {status === "error" ? (
              <MessageState
                title="Os arquivos não carregaram"
                description="Confira a conexão e tente de novo. Seus filtros continuam aqui."
                action={{ label: "Tentar novamente", onClick: () => void loadPage(1, false) }}
              />
            ) : status === "loading" ? (
              <FilesSkeleton />
            ) : result.attachments.length === 0 ? (
              <MessageState
                title={filtered ? "Nenhum arquivo combina com isso" : "Seus arquivos vão aparecer aqui"}
                description={
                  filtered
                    ? "Tente outra palavra ou remova o filtro de formato."
                    : "Envie um PDF, documento ou áudio pela barra do dashboard para começar."
                }
                action={filtered ? { label: "Limpar filtros", onClick: clearFilters } : undefined}
              />
            ) : (
              <>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {result.attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <AttachmentCard
                        attachment={attachment}
                        now={now}
                        onOpen={() => setOpened(attachment)}
                        onDelete={() => {
                          setDeleteError(null);
                          setPendingDelete(attachment);
                        }}
                      />
                    </li>
                  ))}
                </ul>

                {result.hasMore && (
                  <button
                    type="button"
                    onClick={() => void loadPage(result.page + 1, true)}
                    disabled={status === "more"}
                    className="mx-auto mt-8 inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-60"
                  >
                    {status === "more" && (
                      <LoaderCircle
                        className="size-4 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    )}
                    {status === "more" ? "Carregando…" : "Mostrar mais"}
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      </main>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      <FileViewerDialog attachment={opened} onClose={() => setOpened(null)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Apagar este arquivo?"
        description={
          pendingDelete?.note
            ? "O arquivo sai da conta e de todas as lousas. A nota que a Nexo escreveu sobre ele continua nas suas notas."
            : "O arquivo sai da conta e de todas as lousas. Não dá para desfazer."
        }
        subject={pendingDelete?.filename}
        confirmLabel="Apagar arquivo"
        busyLabel="Apagando…"
        busy={deleting}
        error={deleteError}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function FilterButton({
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
        "h-8 shrink-0 rounded-lg px-3 text-sm transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
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
  icon?: LucideIcon;
}) {
  return (
    <label className="relative flex w-full items-center sm:w-fit">
      <span className="sr-only">{label}</span>
      {Icon && (
        <Icon
          className="pointer-events-none absolute left-3 size-4 text-subtle-foreground"
          aria-hidden="true"
        />
      )}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-9 w-full appearance-none sm:w-auto sm:min-w-52 rounded-xl border border-border bg-background pr-9 text-sm text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-accent/40",
          Icon ? "pl-9" : "pl-3"
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 size-4 text-subtle-foreground"
        aria-hidden="true"
      />
    </label>
  );
}

function AttachmentCard({
  attachment,
  now,
  onOpen,
  onDelete,
}: {
  attachment: AttachmentListItem;
  now: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const noteLabel = attachment.note?.title ?? "Sem nota associada";

  async function download() {
    const response = await fetch(`/api/attachments/${attachment.id}?download=1`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    const body = await response.json();
    window.open(body.url, "_blank", "noopener,noreferrer");
  }

  return (
    <article className="group flex min-h-44 flex-col rounded-xl bg-secondary p-4 transition-[background-color,box-shadow] duration-200 hover:bg-tertiary hover:shadow-[0_12px_24px_-20px_color-mix(in_oklab,var(--foreground)_38%,transparent)]">
      <div className="flex items-start justify-between gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background text-subtle-foreground transition-colors group-hover:text-accent-foreground">
          <AttachmentIcon type={attachment.type} className="size-5" />
        </span>
        <span className="pt-1 text-xs tabular-nums text-subtle-foreground">
          {formatBytes(attachment.sizeBytes)}
        </span>
      </div>

      <h2 className="mt-5 truncate text-sm font-semibold text-foreground" title={attachment.filename}>
        {/* O nome é o alvo grande: abrir é o que se faz com um arquivo. */}
        <button
          type="button"
          onClick={onOpen}
          className="max-w-full truncate text-left hover:underline hover:decoration-border hover:underline-offset-4 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {attachment.filename}
        </button>
      </h2>
      <p className="mt-1 text-xs text-subtle-foreground">
        {TYPE_LABEL[attachment.type]} ·{" "}
        <span suppressHydrationWarning>{formatRelative(attachment.createdAt, now)}</span>
      </p>

      <div className="mt-3">
        {attachment.note ? (
          <Link
            href={`/nota/${attachment.note.id}`}
            className="block truncate text-xs text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            title={`Ver nota: ${noteLabel}`}
          >
            Nota: {noteLabel}
          </Link>
        ) : (
          <p className="truncate text-xs text-subtle-foreground">{noteLabel}</p>
        )}
      </div>

      <div className="mt-auto flex items-center gap-1 pt-4">
        <button
          type="button"
          onClick={onOpen}
          className="h-9 flex-1 rounded-lg bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:h-11"
        >
          Abrir
        </button>
        <button
          type="button"
          onClick={() => void download()}
          title="Baixar"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:size-11"
        >
          <Download className="size-4" aria-hidden="true" />
          <span className="sr-only">Baixar {attachment.filename}</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Apagar"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-error/10 hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40 pointer-coarse:size-11"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          <span className="sr-only">Apagar {attachment.filename}</span>
        </button>
      </div>
    </article>
  );
}

/** Um componente, e não uma função que devolve o ícone: o React exige que
 *  componentes existam fora do render. */
function AttachmentIcon({
  type,
  className,
}: {
  type: AttachmentListType;
  className?: string;
}) {
  const props = { className, "aria-hidden": true } as const;
  switch (type) {
    case "audio":
      return <Music2 {...props} />;
    case "document":
      return <FileText {...props} />;
    case "image":
      return <ImageIcon {...props} />;
    case "pdf":
      return <FileType2 {...props} />;
    case "video":
      return <Video {...props} />;
    case "other":
      return <File {...props} />;
    default:
      return <FileAudio {...props} />;
  }
}

function FilesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
      <span className="sr-only">Buscando seus arquivos no servidor…</span>
      {Array.from({ length: 9 }, (_, index) => (
        <div
          key={index}
          className="h-40 animate-pulse rounded-xl bg-secondary motion-reduce:animate-none"
        />
      ))}
    </div>
  );
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
    <div className="flex min-h-72 flex-col items-center justify-center px-5 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-secondary text-subtle-foreground">
        <Paperclip className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-5 h-9 rounded-xl border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
