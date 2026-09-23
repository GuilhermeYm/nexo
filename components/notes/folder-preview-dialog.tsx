"use client";

import { ArrowRight, FolderClosed, SquarePen, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { NoteTypeIcon } from "@/components/dashboard/note-type-icon";
import type { FolderItem } from "@/lib/folders/types";
import { formatRelative } from "@/lib/dashboard/format";
import type { NoteListItem } from "@/lib/notes/list";

const PREVIEW_LIMIT = 6;

type LoadState = "idle" | "loading" | "error";

/**
 * A pré-visualização de uma pasta antes de entrar nela de vez.
 *
 * Abrir uma pasta na galeria costumava trocar direto para a lista filtrada —
 * um salto sem volta fácil. Este diálogo mostra as primeiras notas ali
 * dentro e deixa a pessoa escolher: abrir uma nota específica para editar,
 * ou "Ver melhor" para cair na lista completa, com filtros e busca.
 *
 * Busca pelo mesmo endpoint que o trilho do dashboard já usa
 * (`GET /api/notes?folder=`), então o resultado nunca diverge do que a
 * pessoa veria lá.
 */
export function FolderPreviewDialog({
  folder,
  onOpenChange,
  onViewAll,
}: {
  /** `null` fecha o diálogo. */
  folder: FolderItem | null;
  onOpenChange: (open: boolean) => void;
  /** "Ver melhor": troca para a lista, já filtrada por esta pasta. */
  onViewAll: (folderId: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const requestRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [now] = useState(() => Date.now());

  const open = folder !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!folder) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    void (async () => {
      setState("loading");
      setNotes([]);
      try {
        const params = new URLSearchParams({ folder: folder.id, sort: "updated" });
        const response = await fetch(`/api/notes?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("folder preview request failed");
        const body = (await response.json()) as { notes: NoteListItem[]; total: number };
        if (controller.signal.aborted) return;
        setNotes(body.notes.slice(0, PREVIEW_LIMIT));
        setTotal(body.total);
        setState("idle");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setState("error");
      }
    })();

    return () => controller.abort();
  }, [folder]);

  function close() {
    onOpenChange(false);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/45"
    >
      {folder && (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="flex shrink-0 items-start gap-3.5 border-b border-border p-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-subtle-foreground">
              <FolderClosed className="size-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-base font-semibold text-foreground">
                {folder.name}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {state === "loading"
                  ? "Carregando notas…"
                  : `${total} ${total === 1 ? "nota" : "notas"}`}
              </p>
            </div>
            <button
              type="button"
              autoFocus
              onClick={close}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Fechar</span>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {state === "loading" ? (
              <ul aria-hidden="true" className="flex flex-col gap-1 p-1.5">
                {[0, 1, 2].map((row) => (
                  <li key={row} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                    <span className="size-8 shrink-0 animate-pulse rounded-lg bg-secondary motion-reduce:animate-none" />
                    <span
                      className="h-3.5 flex-1 animate-pulse rounded bg-secondary motion-reduce:animate-none"
                      style={{ maxWidth: `${70 - row * 15}%` }}
                    />
                  </li>
                ))}
              </ul>
            ) : state === "error" ? (
              <p className="px-3.5 py-8 text-center text-sm leading-relaxed text-muted-foreground">
                As notas desta pasta não carregaram.
              </p>
            ) : notes.length === 0 ? (
              <p className="px-3.5 py-8 text-center text-sm leading-relaxed text-muted-foreground">
                Esta pasta ainda está vazia.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {notes.map((note) => (
                  <li key={note.id}>
                    <Link
                      href={`/nota/${note.id}`}
                      onClick={close}
                      title={`Abrir “${note.title}” no editor`}
                      className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-subtle-foreground">
                        <NoteTypeIcon type={note.type} className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {note.title || "Sem título"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
                        {formatRelative(note.updatedAt, now)}
                      </span>
                      <SquarePen
                        className="size-3.5 shrink-0 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
                {total > notes.length && (
                  <li className="px-3.5 py-2 text-xs text-subtle-foreground">
                    +{total - notes.length} {total - notes.length === 1 ? "outra nota" : "outras notas"}
                  </li>
                )}
              </ul>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-3.5">
            <button
              type="button"
              onClick={close}
              className="h-9 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={() => onViewAll(folder.id)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Ver melhor
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
