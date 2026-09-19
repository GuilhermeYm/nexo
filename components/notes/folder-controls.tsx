"use client";

import {
  ChevronDown,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FOLDER_NAME_MAX, type FolderFilter, type FolderItem } from "@/lib/folders/types";
import { cn } from "@/lib/utils";

/**
 * As pastas em Notas: o filtro (com renomear e apagar a pasta escolhida) e o
 * seletor da prévia, que move a nota. Toda escrita passa por `/api/folders` e
 * `/api/notes/[id]/folder` — o cliente não escreve pastas pelo PostgREST.
 */

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

const NEW_FOLDER = "__new__";

/* ---------------------------------------------------------------------- */
/* Filtro                                                                  */
/* ---------------------------------------------------------------------- */

export function FolderFilterBar({
  folders,
  value,
  showAskNexo,
  onChange,
  onFoldersChanged,
  onAskNexo,
}: {
  folders: FolderItem[];
  value: FolderFilter;
  /** O atalho que abre o cartão "Reler e organizar" mesmo dispensado. */
  showAskNexo: boolean;
  onChange: (value: FolderFilter) => void;
  /** Uma pasta foi renomeada ou apagada: recarregar pastas e lista. */
  onFoldersChanged: (removedId?: string) => void;
  onAskNexo: () => void;
}) {
  const inputId = useId();
  const selected = folders.find((folder) => folder.id === value) ?? null;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "deleting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const renameButtonRef = useRef<HTMLButtonElement>(null);

  /** Fecha o formulário e devolve o foco a quem o abriu. */
  function closeRename() {
    setRenaming(false);
    setError(null);
    requestAnimationFrame(() => renameButtonRef.current?.focus());
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setStatus("saving");
    setError(null);
    const response = await fetch(`/api/folders/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    setStatus("idle");
    if (!response?.ok) {
      setError(response ? await readError(response, "Não deu para renomear.") : "Sem conexão.");
      return;
    }
    closeRename();
    onFoldersChanged();
  }

  async function remove() {
    if (!selected) return;
    setStatus("deleting");
    setError(null);
    const response = await fetch(`/api/folders/${selected.id}`, { method: "DELETE" }).catch(
      () => null
    );
    setStatus("idle");
    if (!response?.ok) {
      setError(response ? await readError(response, "Não deu para apagar a pasta.") : "Sem conexão.");
      return;
    }
    setConfirmOpen(false);
    onFoldersChanged(selected.id);
    // Os botões da pasta somem com ela: o foco vai para o filtro.
    requestAnimationFrame(() => selectRef.current?.focus());
  }

  return (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {renaming && selected ? (
        <form onSubmit={(event) => void rename(event)} className="flex flex-wrap items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            Novo nome da pasta
          </label>
          <input
            id={inputId}
            autoFocus
            value={name}
            maxLength={FOLDER_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeRename();
            }}
            className="h-9 w-56 rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          <button
            type="submit"
            disabled={status === "saving" || !name.trim()}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-3 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-45 pointer-coarse:h-11"
          >
            {status === "saving" && (
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            )}
            Salvar
          </button>
          <button
            type="button"
            onClick={closeRename}
            className="h-9 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:h-11"
          >
            Cancelar
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex items-center">
            <span className="sr-only">Pasta</span>
            {value === "all" ? (
              <FolderOpen className="pointer-events-none absolute left-3 size-4 text-subtle-foreground" aria-hidden="true" />
            ) : (
              <FolderClosed className="pointer-events-none absolute left-3 size-4 text-accent" aria-hidden="true" />
            )}
            <select
              ref={selectRef}
              value={value}
              onChange={(event) => {
                setError(null);
                onChange(event.target.value);
              }}
              className={cn(
                "h-9 min-w-48 appearance-none rounded-xl border bg-background pr-9 pl-9 pointer-coarse:h-11 text-sm text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-accent/40",
                value === "all" ? "border-border" : "border-accent/50"
              )}
            >
              <option value="all">Todas as pastas</option>
              <option value="none">Sem pasta</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name} ({folder.noteCount}){folder.source === "ai" ? " · pela Nexo" : ""}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 size-4 text-subtle-foreground" aria-hidden="true" />
          </label>

          {selected && (
            <>
              <button
                ref={renameButtonRef}
                type="button"
                onClick={() => {
                  setName(selected.name);
                  setError(null);
                  setRenaming(true);
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:h-11"
              >
                <Pencil className="size-3.5" aria-hidden="true" />
                Renomear
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setConfirmOpen(true);
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-error transition-colors hover:bg-error/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40 pointer-coarse:h-11"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Apagar pasta
              </button>
            </>
          )}
        </div>
      )}

      {showAskNexo && !renaming && (
        <button
          type="button"
          onClick={onAskNexo}
          className="inline-flex h-9 items-center gap-1.5 self-start rounded-xl px-3 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:h-11 sm:ml-auto sm:self-auto"
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          Reler e organizar
        </button>
      )}

      {error && !confirmOpen && (
        <p role="alert" className="text-sm text-error sm:basis-full">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Apagar esta pasta?"
        description="As notas dela não são apagadas: voltam para “Sem pasta”."
        subject={selected ? `${selected.name} · ${selected.noteCount} ${selected.noteCount === 1 ? "nota" : "notas"}` : undefined}
        confirmLabel="Apagar pasta"
        busyLabel="Apagando…"
        busy={status === "deleting"}
        error={confirmOpen ? error ?? undefined : undefined}
        onOpenChange={setConfirmOpen}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Seletor da prévia — mover a nota                                        */
/* ---------------------------------------------------------------------- */

export function NoteFolderPicker({
  noteId,
  folder,
  folders,
  onMoved,
}: {
  noteId: string;
  folder: { id: string; name: string; source: "user" | "ai" } | null;
  folders: FolderItem[];
  /** A nota mudou de pasta (ou uma pasta nova nasceu). */
  onMoved: (folder: { id: string; name: string; source: "user" | "ai" } | null) => void;
}) {
  const selectId = useId();
  const inputId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  // O `<select>` só escolhe; mover é o botão. No Chrome de Windows e Linux,
  // as setas num select fechado disparam `change` a cada passo — mover no
  // `change` mandaria uma requisição por seta.
  const current = folder?.id ?? "";
  const [draft, setDraft] = useState(current);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function backToSelect() {
    setCreating(false);
    setError(null);
    setDraft(current);
    requestAnimationFrame(() => selectRef.current?.focus());
  }

  async function moveTo(folderId: string | null, folderName: string | null) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/notes/${noteId}/folder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError(response ? await readError(response, "Não deu para mover a nota.") : "Sem conexão.");
      return false;
    }
    setDraft(folderId ?? "");
    onMoved(folderId && folderName ? { id: folderId, name: folderName, source: "user" } : null);
    return true;
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (!response?.ok) {
      setBusy(false);
      setError(response ? await readError(response, "Não deu para criar a pasta.") : "Sem conexão.");
      return;
    }
    const body = (await response.json()) as { folder: FolderItem };
    if (await moveTo(body.folder.id, body.folder.name)) {
      setCreating(false);
      setName("");
      requestAnimationFrame(() => selectRef.current?.focus());
    }
  }

  const target = folders.find((item) => item.id === draft) ?? null;
  const changed = draft !== current;

  return (
    <div className="mt-3">
      {creating ? (
        <form onSubmit={(event) => void create(event)} className="flex flex-wrap items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            Nome da pasta nova
          </label>
          <input
            id={inputId}
            autoFocus
            value={name}
            placeholder="Nome da pasta"
            maxLength={FOLDER_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") backToSelect();
            }}
            className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:h-11"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="h-8 rounded-lg bg-accent px-3 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-45 pointer-coarse:h-11"
          >
            Criar e mover
          </button>
          <button
            type="button"
            onClick={backToSelect}
            className="h-8 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:h-11"
          >
            Cancelar
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="text-xs text-subtle-foreground">
            Pasta
          </label>
          <span className="relative flex items-center">
            <FolderClosed className="pointer-events-none absolute left-2.5 size-3.5 text-subtle-foreground" aria-hidden="true" />
            <select
              ref={selectRef}
              id={selectId}
              value={draft}
              disabled={busy}
              onChange={(event) => {
                setError(null);
                setDraft(event.target.value);
              }}
              className="h-8 max-w-56 appearance-none rounded-lg border border-border bg-background pr-8 pl-8 text-sm text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 pointer-coarse:h-11"
            >
              <option value="">Sem pasta</option>
              {folders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              <option value={NEW_FOLDER}>Nova pasta…</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-subtle-foreground" aria-hidden="true" />
          </span>
          {changed && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (draft === NEW_FOLDER) {
                    setCreating(true);
                    return;
                  }
                  void moveTo(target?.id ?? null, target?.name ?? null);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-45 pointer-coarse:h-11"
              >
                {busy && (
                  <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                )}
                {draft === NEW_FOLDER ? "Criar pasta…" : "Mover"}
              </button>
              <button
                type="button"
                onClick={() => setDraft(current)}
                className="h-8 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:h-11"
              >
                Cancelar
              </button>
            </>
          )}
          {!changed && folder?.source === "ai" && (
            <span className="inline-flex items-center gap-1 text-xs text-subtle-foreground">
              <FolderPlus className="size-3" aria-hidden="true" />
              posta pela Nexo
            </span>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
