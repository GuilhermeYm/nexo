"use client";

import { FolderClosed, Inbox } from "lucide-react";
import { useState } from "react";

import { NoteContextMenu, useNoteDeletion } from "@/components/dashboard/note-context-menu";
import { NOTE_TYPE_LABEL, NoteTypeIcon } from "@/components/dashboard/note-type-icon";
import { formatRelative } from "@/lib/dashboard/format";
import type { FolderItem } from "@/lib/folders/types";
import type { NoteListItem } from "@/lib/notes/list";
import { TAG_CHIP_CLASS, tagTone } from "@/lib/tags/palette";
import { cn } from "@/lib/utils";

/** A coluna das notas sem pasta — o mesmo valor que `?folder=none` aceita. */
export const KANBAN_UNFILED = "none";

export interface KanbanColumnData {
  id: string;
  name: string;
  notes: NoteListItem[];
}

/**
 * Todas as notas em colunas por pasta, arrastáveis entre elas.
 *
 * Existe ao lado da lista, não no lugar dela: a lista pagina 18 por vez e é
 * o inventário completo; o Kanban busca um lote maior (ver `loadKanban` em
 * `notes-view.tsx`) para que as colunas façam sentido, mas continua sendo um
 * retrato, não uma segunda fonte de verdade. Mover um card chama a mesma
 * rota que o seletor de pasta da prévia (`PUT /api/notes/[id]/folder`).
 *
 * Arrastar é só o atalho de mouse. O menu de contexto do card (botão direito
 * ou toque longo) tem a mesma opção "Organizar", para quem usa toque ou
 * teclado.
 */
export function NotesKanbanBoard({
  columns,
  folders,
  now,
  onOpenNote,
  onMoveNote,
  onCreateFolder,
  onDeleteRequest,
  onError,
}: {
  columns: KanbanColumnData[];
  folders: FolderItem[];
  now: number;
  onOpenNote: (noteId: string) => void;
  onMoveNote: (noteId: string, folderId: string | null) => void;
  onCreateFolder: () => void;
  onDeleteRequest: ReturnType<typeof useNoteDeletion>["request"];
  onError: (message: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);

  return (
    <div className="relative min-w-0">
    <div
      role="group"
      aria-label="Notas por pasta"
      className="flex w-full gap-4 overflow-x-auto pb-3"
    >
      {columns.map((column) => {
        const isUnfiled = column.id === KANBAN_UNFILED;
        const isOver = overColumn === column.id;
        const currentFolderId = isUnfiled ? null : column.id;

        return (
          <section
            key={column.id}
            aria-label={column.name}
            onDragOver={(event) => {
              if (!draggingId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (overColumn !== column.id) setOverColumn(column.id);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setOverColumn((current) => (current === column.id ? null : current));
            }}
            onDrop={(event) => {
              event.preventDefault();
              setOverColumn(null);
              const noteId = event.dataTransfer.getData("text/plain");
              if (!noteId) return;
              const note = column.notes.find((item) => item.id === noteId);
              // O próprio drop na coluna de origem não é um destino novo.
              if (note) return;
              onMoveNote(noteId, currentFolderId);
            }}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-2xl border bg-secondary/40 transition-colors duration-150",
              isOver ? "border-accent bg-accent/10" : "border-border"
            )}
          >
            <header className="flex shrink-0 items-center gap-2 px-3.5 pt-3.5 pb-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-background text-subtle-foreground">
                {isUnfiled ? (
                  <Inbox className="size-3.5" aria-hidden="true" />
                ) : (
                  <FolderClosed className="size-3.5" aria-hidden="true" />
                )}
              </span>
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {column.name}
              </h3>
              <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
                {column.notes.length}
              </span>
            </header>

            <ul className="flex min-h-16 flex-1 flex-col gap-2 px-2 pb-3">
              {column.notes.length === 0 ? (
                <li
                  className={cn(
                    "flex flex-1 items-center justify-center rounded-xl border border-dashed px-3 py-6 text-center text-xs leading-relaxed text-subtle-foreground transition-colors",
                    isOver ? "border-accent/60" : "border-border"
                  )}
                >
                  Arraste uma nota para cá
                </li>
              ) : (
                column.notes.map((note) => (
                  <NoteContextMenu
                    key={note.id}
                    note={note}
                    workspaces={[]}
                    hideWorkspace
                    openLabel="Abrir prévia"
                    folders={folders}
                    currentFolderId={note.folder?.id ?? null}
                    onOpen={() => onOpenNote(note.id)}
                    onMoveToFolder={(folderId) => onMoveNote(note.id, folderId)}
                    onCreateFolder={onCreateFolder}
                    onDelete={onDeleteRequest}
                    onError={onError}
                  >
                    <li>
                      <article
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", note.id);
                          event.dataTransfer.effectAllowed = "move";
                          setDraggingId(note.id);
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setOverColumn(null);
                        }}
                        onClick={() => onOpenNote(note.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onOpenNote(note.id);
                          }
                        }}
                        title={note.title || "Sem título"}
                        className={cn(
                          "cursor-grab rounded-xl border border-border bg-background p-3 text-left shadow-sm transition-[opacity,border-color] duration-150 active:cursor-grabbing hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                          draggingId === note.id && "opacity-40"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-subtle-foreground">
                            <NoteTypeIcon type={note.type} className="size-3.5" />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                            {note.title || "Sem título"}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {note.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag.id}
                              className={cn(
                                "rounded-md px-1.5 py-0.5 text-[11px]",
                                TAG_CHIP_CLASS[tagTone(tag)]
                              )}
                            >
                              {tag.name}
                            </span>
                          ))}
                          {note.tags.length > 2 && (
                            <span className="text-[11px] text-subtle-foreground">
                              +{note.tags.length - 2}
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-subtle-foreground">
                          <span className="truncate">{NOTE_TYPE_LABEL[note.type] ?? "Nota"}</span>
                          <span className="shrink-0 tabular-nums">
                            {formatRelative(note.updatedAt, now)}
                          </span>
                        </div>
                      </article>
                    </li>
                  </NoteContextMenu>
                ))
              )}
            </ul>
          </section>
        );
      })}
      </div>
      {/* A quarta coluna corta na borda quando não cabem todas — sem isso, a
          borda lê como um card quebrado, não como "role para o lado". */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent"
      />
    </div>
  );
}
