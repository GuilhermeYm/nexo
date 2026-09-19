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
  FolderClosed,
  FolderPlus,
  Folders,
  LoaderCircle,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  NOTE_TYPE_LABEL,
  NoteTypeIcon,
} from "@/components/dashboard/note-type-icon";
import { AiReviewCard } from "@/components/notes/ai-review-card";
import { NoteContextMenu, useNoteDeletion } from "@/components/dashboard/note-context-menu";
import { CreateFolderDialog } from "@/components/notes/create-folder-dialog";
import { DeleteTagsChoice } from "@/components/notes/delete-tags-choice";
import { FolderFilterBar, NoteFolderPicker } from "@/components/notes/folder-controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatAbsolute,
  formatRelative,
  toIsoString,
} from "@/lib/dashboard/format";
import type { FolderFilter, FolderItem } from "@/lib/folders/types";
import type { NoteDeletionImpact } from "@/lib/notes/deletion-impact";
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
  initialFolder = "all",
}: {
  initial: NoteListResult | null;
  renderedAt: number;
  /** A pasta pedida na URL (`?folder=`), vinda da barra lateral. */
  initialFolder?: FolderFilter;
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(
    () => new Set()
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "deleting" | "error">(
    "idle"
  );
  const [deleteAttachments, setDeleteAttachments] = useState(false);
  const [deleteTags, setDeleteTags] = useState(false);
  const [deletionImpact, setDeletionImpact] = useState<NoteDeletionImpact | null>(null);
  const [impactStatus, setImpactStatus] = useState<"idle" | "loading" | "error">("idle");
  const [folderFilter, setFolderFilter] = useState<FolderFilter>(initialFolder);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  // Muda quando pastas ou pertenças mudam: o cartão da Nexo reconta.
  const [reviewKey, setReviewKey] = useState(0);
  const [forceReview, setForceReview] = useState(false);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [section, setSection] = useState<"notes" | "folders">("notes");
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [noteWaitingForFolder, setNoteWaitingForFolder] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const firstRequest = useRef(true);

  const singleDeletion = useNoteDeletion({
    onDeleted: (note) => {
      if (selectedNoteId === note.id) closePreview();
      void loadPage(1, false);
      void loadFolders();
    },
    onError: setNotice,
  });

  const loadFolders = useCallback(async () => {
    try {
      const response = await fetch("/api/folders");
      if (!response.ok) return;
      const body = (await response.json()) as { folders: FolderItem[] };
      setFolders(body.folders);
    } catch {
      // Sem pastas carregadas, o filtro mostra só "Todas" e "Sem pasta".
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadFolders();
    })();
  }, [loadFolders]);

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
    // `loadPage` intentionally reads the current controls. The values below
    // are the only events that start a fresh inventory request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, source, type, sort, folderFilter]);

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
      folder: folderFilter,
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

  const filtered =
    query.trim() || source !== "all" || type !== "all" || folderFilter !== "all";

  // A Nexo terminou de reler/organizar, ou uma pasta mudou: tudo recarrega.
  const refreshAfterFolders = useCallback(() => {
    void loadFolders();
    void loadPage(1, false);
    setReviewKey((key) => key + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFolders, query, source, type, sort, folderFilter]);

  function noteMoved(
    noteId: string,
    folder: NoteListItem["folder"]
  ) {
    setResult((current) => ({
      ...current,
      notes: current.notes.map((note) => (note.id === noteId ? { ...note, folder } : note)),
    }));
    setPreview((current) => (current && current.id === noteId ? { ...current, folder } : current));
    void loadFolders();
    setReviewKey((key) => key + 1);
  }

  async function moveNoteFromMenu(noteId: string, folderId: string | null) {
    setNotice(null);
    const response = await fetch(`/api/notes/${noteId}/folder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    }).catch(() => null);
    if (!response?.ok) {
      setNotice(response ? "Não deu para organizar a nota." : "Sem conexão.");
      return;
    }
    const body = (await response.json()) as { folder: NoteListItem["folder"] };
    noteMoved(noteId, body.folder);
    if (folderFilter !== "all") void loadPage(1, false);
  }

  function clearFilters() {
    resetSelection();
    setQuery("");
    setSource("all");
    setType("all");
    setSort("updated");
    setFolderFilter("all");
    inputRef.current?.focus();
  }

  function resetSelection() {
    setSelectedNoteIds(new Set());
    setDeleteDialogOpen(false);
    setDeleteAttachments(false);
    setDeleteTags(false);
    setDeletionImpact(null);
    setImpactStatus("idle");
  }

  async function openDeleteDialog() {
    setDeleteStatus("idle");
    setDeleteAttachments(false);
    setDeleteTags(false);
    setDeletionImpact(null);
    setImpactStatus("loading");
    setDeleteDialogOpen(true);

    await loadDeletionImpact();
  }

  async function loadDeletionImpact() {
    setImpactStatus("loading");
    try {
      const response = await fetch("/api/notes/deletion-impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selectedNoteIds] }),
      });
      if (!response.ok) throw new Error("impact request failed");
      const nextImpact = (await response.json()) as NoteDeletionImpact;
      setDeletionImpact(nextImpact);
      if (nextImpact.attachmentCount === 0) setDeleteAttachments(false);
      setImpactStatus("idle");
    } catch {
      setImpactStatus("error");
    }
  }

  function toggleNoteSelection(noteId: string) {
    setSelectedNoteIds((current) => {
      const next = new Set(current);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  function toggleVisibleNotes() {
    const visibleIds = result.notes.map((note) => note.id);
    const everyVisibleNoteIsSelected = visibleIds.every((id) => selectedNoteIds.has(id));
    setSelectedNoteIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        if (everyVisibleNoteIsSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function deleteSelectedNotes() {
    if (selectedNoteIds.size === 0) return;
    setDeleteStatus("deleting");

    try {
      const response = await fetch("/api/notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [...selectedNoteIds],
          deleteAttachments,
          deleteTags,
        }),
      });
      if (!response.ok) throw new Error("delete request failed");

      setSelectedNoteIds(new Set());
      setSelectionMode(false);
      setDeleteDialogOpen(false);
      setDeleteStatus("idle");
      closePreview();
      await loadPage(1, false);
    } catch {
      setDeleteStatus("error");
    }
  }

  const everyVisibleNoteIsSelected =
    result.notes.length > 0 && result.notes.every((note) => selectedNoteIds.has(note.id));

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
                  Notas e pastas
                </h1>
              </div>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Encontre o que você guardou e organize do seu jeito, sem perder
                a ajuda da Nexo.
              </p>
            </div>
            <div className="flex items-center gap-3">
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
              <button
                type="button"
                onClick={() => {
                  setSelectionMode((active) => !active);
                  setSelectedNoteIds(new Set());
                }}
                className={cn(
                  "h-9 rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                  selectionMode
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-error/30 text-error hover:bg-error/10"
                )}
              >
                {selectionMode ? (
                  "Cancelar"
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Trash2 className="size-4" aria-hidden="true" />
                    Apagar
                  </span>
                )}
              </button>
            </div>
          </header>

          <Tabs value={section} onValueChange={(value) => setSection(value as "notes" | "folders")} className="mt-8">
            <TabsList aria-label="Conteúdo do acervo">
              <TabsTrigger value="notes">
                <FileText className="size-4" aria-hidden="true" />
                Notas
              </TabsTrigger>
              <TabsTrigger value="folders">
                <Folders className="size-4" aria-hidden="true" />
                Pastas
                <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] tabular-nums text-subtle-foreground">
                  {folders.length}
                </span>
              </TabsTrigger>
            </TabsList>

          <TabsContent value="notes">
          <AiReviewCard
            refreshKey={reviewKey}
            forceOpen={forceReview}
            onForceClose={() => setForceReview(false)}
            onDone={refreshAfterFolders}
            onVisibleChange={setReviewVisible}
          />

          {notice && (
            <p role="alert" className="mt-4 rounded-xl bg-error/10 px-3.5 py-3 text-sm text-error">
              {notice}
            </p>
          )}

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
                onChange={(event) => {
                  resetSelection();
                  setQuery(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    if (query) {
                      resetSelection();
                      setQuery("");
                    }
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
                    resetSelection();
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
                <SourceButton active={source === "all"} onClick={() => {
                  resetSelection();
                  setSource("all");
                }}>
                  Todas
                </SourceButton>
                <SourceButton active={source === "user"} onClick={() => {
                  resetSelection();
                  setSource("user");
                }}>
                  <UserRound className="size-3.5" aria-hidden="true" />
                  Você
                </SourceButton>
                <SourceButton active={source === "ai"} onClick={() => {
                  resetSelection();
                  setSource("ai");
                }}>
                  <Sparkles className="size-3.5" aria-hidden="true" />
                  Nexo
                </SourceButton>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <SelectControl
                  label="Tipo"
                  value={type}
                  onChange={(value) => {
                    resetSelection();
                    setType(value as TypeFilter);
                  }}
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
                  onChange={(value) => {
                    resetSelection();
                    setSort(value as NoteListSort);
                  }}
                  options={SORT_OPTIONS}
                  icon={sort === "title" ? ArrowDownAZ : CalendarClock}
                />
              </div>
            </div>

            <FolderFilterBar
              folders={folders}
              value={folderFilter}
              showAskNexo={!reviewVisible}
              onChange={(value) => {
                resetSelection();
                setFolderFilter(value);
              }}
              onFoldersChanged={(removedId) => {
                if (removedId && folderFilter === removedId) setFolderFilter("all");
                refreshAfterFolders();
              }}
              onAskNexo={() => setForceReview(true)}
            />
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
                {selectionMode && (
                  <div className="mb-4 flex flex-col gap-3 rounded-xl bg-secondary px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                    <p className="text-sm font-medium text-foreground" aria-live="polite">
                      {selectedNoteIds.size === 0
                        ? "Escolha as notas que deseja apagar"
                        : `${selectedNoteIds.size} ${selectedNoteIds.size === 1 ? "nota selecionada" : "notas selecionadas"}`}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={toggleVisibleNotes}
                        className="h-9 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        {everyVisibleNoteIsSelected ? "Limpar seleção" : "Selecionar visíveis"}
                      </button>
                      <button
                        type="button"
                        disabled={selectedNoteIds.size === 0}
                        onClick={() => void openDeleteDialog()}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-error px-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/50 disabled:pointer-events-none disabled:opacity-45 dark:text-background"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        Apagar
                      </button>
                    </div>
                  </div>
                )}
                <div
                  className={cn(
                    "grid min-h-0 gap-6",
                    selectedNoteId && "lg:grid-cols-[minmax(0,1fr)_minmax(21rem,0.8fr)]"
                  )}
                >
                  <ul className="divide-y divide-border border-y border-border">
                    {result.notes.map((note) => (
                      <NoteContextMenu
                        key={note.id}
                        note={note}
                        workspaces={[]}
                        hideWorkspace
                        openLabel="Abrir prévia"
                        folders={folders}
                        currentFolderId={note.folder?.id ?? null}
                        onOpen={() => void showPreview(note.id)}
                        onMoveToFolder={(folderId) => void moveNoteFromMenu(note.id, folderId)}
                        onCreateFolder={() => {
                          setNoteWaitingForFolder(note.id);
                          setCreateFolderOpen(true);
                        }}
                        onDelete={singleDeletion.request}
                        onError={setNotice}
                      >
                        <NoteRow
                          note={note}
                          now={now}
                          selected={note.id === selectedNoteId}
                          selectionMode={selectionMode}
                          checked={selectedNoteIds.has(note.id)}
                          onCheckedChange={() => toggleNoteSelection(note.id)}
                          onSelect={() => void showPreview(note.id)}
                        />
                      </NoteContextMenu>
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
                        folders={folders}
                        onMoved={noteMoved}
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
          </TabsContent>

          <TabsContent value="folders" className="mt-8">
              <FolderGallery
                folders={folders}
                onCreate={() => {
                  setNoteWaitingForFolder(null);
                  setCreateFolderOpen(true);
                }}
                onOpen={(folderId) => {
                  resetSelection();
                  setFolderFilter(folderId);
                  setSection("notes");
                }}
              />
          </TabsContent>
          </Tabs>
        </div>
      </main>
      {singleDeletion.dialog}
      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={(open) => {
          setCreateFolderOpen(open);
          if (!open) setNoteWaitingForFolder(null);
        }}
        onCreated={(folder) => {
          setFolders((current) => [...current, folder].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
          if (noteWaitingForFolder) void moveNoteFromMenu(noteWaitingForFolder, folder.id);
          setReviewKey((key) => key + 1);
        }}
      />
      <ConfirmDialog
        open={deleteDialogOpen}
        title="Apagar notas selecionadas?"
        description="Elas sairão do seu acervo e das lousas em que estiverem abertas. Esta ação não pode ser desfeita agora."
        subject={`${selectedNoteIds.size} ${selectedNoteIds.size === 1 ? "nota selecionada" : "notas selecionadas"}`}
        confirmLabel="Apagar notas"
        busyLabel="Apagando notas…"
        busy={deleteStatus === "deleting"}
        error={deleteStatus === "error" ? "Não foi possível apagar as notas. Tente novamente." : undefined}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={() => void deleteSelectedNotes()}
      >
        <label
          className={cn(
            "flex items-start gap-3 rounded-xl bg-secondary px-3.5 py-3 text-sm transition-opacity",
            deletionImpact?.attachmentCount
              ? "cursor-pointer text-foreground"
              : "cursor-default text-muted-foreground opacity-70"
          )}
        >
          <input
            type="checkbox"
            checked={deleteAttachments}
            onChange={(event) => setDeleteAttachments(event.target.checked)}
            disabled={
              deleteStatus === "deleting" ||
              impactStatus !== "idle" ||
              !deletionImpact?.attachmentCount
            }
            className="mt-0.5 size-4 accent-error"
          />
          <span>
            <span className="block font-medium">Apagar também os arquivos associados</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {impactStatus === "loading"
                ? "Verificando os arquivos destas notas…"
                : deletionImpact?.attachmentCount
                  ? `${deletionImpact.attachmentCount} ${deletionImpact.attachmentCount === 1 ? "arquivo associado será removido" : "arquivos associados serão removidos"} permanentemente.`
                  : impactStatus === "error"
                    ? "Não foi possível verificar os arquivos; esta opção permanece indisponível."
                    : "As notas selecionadas não têm arquivos associados."}
            </span>
          </span>
          {impactStatus === "loading" && (
            <LoaderCircle
              className="mt-0.5 ml-auto size-4 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
        </label>
        <DeleteTagsChoice
          impact={deletionImpact}
          status={impactStatus}
          checked={deleteTags}
          disabled={deleteStatus === "deleting"}
          onCheckedChange={setDeleteTags}
          onRetry={() => void loadDeletionImpact()}
        />
      </ConfirmDialog>
    </div>
  );
}

function FolderGallery({
  folders,
  onCreate,
  onOpen,
}: {
  folders: FolderItem[];
  onCreate: () => void;
  onOpen: (folderId: string) => void;
}) {
  return (
    <section aria-labelledby="folders-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="folders-heading" className="text-lg font-semibold text-foreground">Suas pastas</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Pastas são formas de reunir notas sem mudar o conteúdo delas. As criadas pela Nexo continuam sob seu controle.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <FolderPlus className="size-4" aria-hidden="true" />
          Nova pasta
        </button>
      </div>

      {folders.length === 0 ? (
        <div className="mt-8 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-secondary/30 px-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-subtle-foreground">
            <Folders className="size-5" aria-hidden="true" />
          </span>
          <h3 className="mt-4 font-semibold text-foreground">Nenhuma pasta ainda</h3>
          <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Crie a primeira agora ou deixe a Nexo sugerir uma organização para o seu acervo.
          </p>
          <button type="button" onClick={onCreate} className="mt-5 rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
            Criar primeira pasta
          </button>
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => (
            <li key={folder.id}>
              <button
                type="button"
                onClick={() => onOpen(folder.id)}
                className="group flex min-h-36 w-full flex-col rounded-2xl border border-border bg-background p-4 text-left transition-[border-color,background-color,transform] duration-150 hover:-translate-y-0.5 hover:border-accent/45 hover:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transform-none"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-subtle-foreground transition-colors group-hover:bg-accent/10 group-hover:text-accent">
                  <FolderClosed className="size-5" aria-hidden="true" />
                </span>
                <span className="mt-4 line-clamp-2 font-semibold text-foreground">{folder.name}</span>
                <span className="mt-auto flex w-full items-center justify-between gap-3 pt-3 text-xs text-subtle-foreground">
                  <span>{folder.noteCount} {folder.noteCount === 1 ? "nota" : "notas"}</span>
                  <span>{folder.source === "ai" ? "pela Nexo" : "criada por você"}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
  selectionMode,
  checked,
  onCheckedChange,
  onSelect,
}: {
  note: NoteListItem;
  now: number;
  selected: boolean;
  selectionMode: boolean;
  checked: boolean;
  onCheckedChange: () => void;
  onSelect: () => void;
}) {
  return (
    <li className="flex">
      {selectionMode && (
        <label className="flex shrink-0 cursor-pointer items-start px-3 pt-7 sm:px-4" title={`Selecionar ${note.title}`}>
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheckedChange}
            className="size-4 rounded border-border accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          <span className="sr-only">Selecionar {note.title}</span>
        </label>
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        title="Clique para ler a prévia"
        className={cn(
          "group grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-1 py-5 text-left transition-colors hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-4",
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

          {note.summary ? (
            // O que a IA escreveu é sempre identificável: o brilho e o rótulo
            // para leitor de tela marcam que esta linha é o resumo da Nexo.
            <span className="mt-1.5 line-clamp-2 block max-w-2xl text-sm leading-relaxed text-muted-foreground">
              <Sparkles
                className="mr-1.5 inline size-3.5 -translate-y-px text-subtle-foreground"
                aria-hidden="true"
              />
              <span className="sr-only">Resumo da Nexo: </span>
              {note.summary}
            </span>
          ) : note.excerpt ? (
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
            {note.folder && (
              <>
                <Dot />
                <span className="inline-flex items-center gap-1">
                  <FolderClosed className="size-3" aria-hidden="true" />
                  {note.folder.name}
                </span>
              </>
            )}
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

export function NotePreviewPanel({
  preview,
  status,
  folders = [],
  onMoved,
  now,
  onClose,
  onRetry,
}: {
  preview: NotePreview | null;
  status: "idle" | "loading" | "error";
  /** A busca global só lê; em Notas, a prévia também permite mover de pasta. */
  folders?: FolderItem[];
  onMoved?: (noteId: string, folder: NotePreview["folder"]) => void;
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
            {onMoved && (
              <NoteFolderPicker
                key={preview.id}
                noteId={preview.id}
                folder={preview.folder}
                folders={folders}
                onMoved={(folder) => onMoved(preview.id, folder)}
              />
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {preview.summary && (
          <section
            aria-label="Resumo da Nexo"
            className="mb-5 rounded-xl bg-secondary px-4 py-3.5"
          >
            <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-medium text-subtle-foreground">
              <Sparkles className="size-3 shrink-0" aria-hidden="true" />
              <span>Resumo da Nexo</span>
              {preview.summaryStale && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>de uma versão anterior</span>
                </>
              )}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground">
              {preview.summary}
            </p>
          </section>
        )}
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
