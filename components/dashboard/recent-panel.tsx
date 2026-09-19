"use client";

import { Inbox, Sparkles } from "lucide-react";
import { useState } from "react";

import {
  NoteContextMenu,
  useNoteDeletion,
  type NoteMenuTarget,
} from "@/components/dashboard/note-context-menu";
import {
  NOTE_TYPE_LABEL,
  NoteTypeIcon,
} from "@/components/dashboard/note-type-icon";
import { EmptyState, Panel, QuietFooter } from "@/components/dashboard/panel";
import { useLiveResource } from "@/hooks/use-live-resource";
import { useNewItems } from "@/hooks/use-new-items";
import {
  formatAbsolute,
  formatRelative,
  STALE_AFTER_MS,
  toIsoString,
} from "@/lib/dashboard/format";
import type { RecentNote, WorkspaceSummary } from "@/lib/dashboard/queries";
import { cn } from "@/lib/utils";

const TABLES = ["notes"] as const;

const noteId = (note: RecentNote) => note.id;

/** Quando a lista foi tocada por último, para o convite de repouso. */
function lastTouched(notes: RecentNote[]): number {
  return notes.reduce((newest, note) => {
    const stamp = new Date(note.updatedAt).getTime();
    return stamp > newest ? stamp : newest;
  }, 0);
}

/** Os seis matizes de tag do tema, endereçados pela posição gravada no banco. */
const TAG_TONE: Record<string, string> = {
  "1": "bg-tag-1 text-tag-1-foreground",
  "2": "bg-tag-2 text-tag-2-foreground",
  "3": "bg-tag-3 text-tag-3-foreground",
  "4": "bg-tag-4 text-tag-4-foreground",
  "5": "bg-tag-5 text-tag-5-foreground",
  "6": "bg-tag-6 text-tag-6-foreground",
};

/**
 * "Recentes" — as notas que o usuário tocou por último, dele ou da IA.
 *
 * A marca de autoria não é enfeite: o princípio de produto diz que o que a IA
 * criou é sempre identificável. Então toda linha de origem `ai` carrega o
 * selo, e ele nunca some.
 *
 * O menu de cada linha é o `NoteContextMenu`, o mesmo que o trilho usa nas
 * notas dentro das pastas.
 */
export function RecentPanel({
  initial,
  renderedAt,
  now,
  workspaces,
  onOpenNote,
  onCreateNote,
}: {
  initial: RecentNote[];
  renderedAt: number;
  now: number;
  /** Alimenta o submenu "Abrir no workspace". */
  workspaces: WorkspaceSummary[];
  onOpenNote: (noteId: string) => void;
  /** Abre o rascunho do dashboard. */
  onCreateNote?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const { items, status, isRefreshing, refresh } = useLiveResource<RecentNote>({
    endpoint: "/api/notes/recent",
    field: "notes",
    initial,
    tables: [...TABLES],
  });

  // Um diálogo de exclusão para a lista inteira, não um por linha.
  const deletion = useNoteDeletion({ onDeleted: refresh, onError: setError });

  const fresh = useNewItems(items, noteId);
  const clock = now || renderedAt;
  const quiet =
    items.length > 0 && lastTouched(items) < clock - STALE_AFTER_MS;

  return (
    <Panel title="Recentes" status={status} isRefreshing={isRefreshing}>
      {items.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-5" aria-hidden="true" />}
          title="Nada guardado ainda"
          description="Solte um arquivo na barra acima, ou arraste um para dentro dela. O que você guardar e o que a Nexo criar aparecem aqui, do mais recente para o mais antigo."
          action={
            onCreateNote
              ? { label: "Escrever uma nota", onClick: onCreateNote }
              : undefined
          }
        />
      ) : (
        <div className="flex min-h-full flex-col">
          <ul className="divide-y divide-border">
            {items.map((note, index) => (
              <RecentRow
                key={note.id}
                note={note}
                now={clock}
                isNew={fresh.has(note.id)}
                entranceIndex={index}
                workspaces={workspaces}
                onOpen={() => onOpenNote(note.id)}
                onDelete={deletion.request}
                onError={setError}
              />
            ))}
          </ul>

          {quiet && (
            <QuietFooter
              label="Faz um tempo desde a última captura."
              actionLabel={onCreateNote ? "Escrever uma nota" : undefined}
              onAction={onCreateNote}
            />
          )}
        </div>
      )}

      {error && (
        <p
          role="status"
          className="border-t border-border px-4 py-2.5 text-xs leading-relaxed text-error"
        >
          {error}
        </p>
      )}
      {deletion.dialog}
    </Panel>
  );
}

/**
 * Uma nota na lista de Recentes.
 *
 * O clique abre no editor; o botão direito (ou o toque longo) abre as outras
 * saídas. Separar assim mantém a linha limpa: a ação de sempre não pede
 * ícone, e as ocasionais não ocupam espaço permanente.
 */
function RecentRow({
  note,
  now,
  isNew,
  entranceIndex,
  workspaces,
  onOpen,
  onDelete,
  onError,
}: {
  note: RecentNote;
  now: number;
  isNew: boolean;
  entranceIndex: number;
  workspaces: WorkspaceSummary[];
  onOpen: () => void;
  onDelete: (note: NoteMenuTarget) => void;
  onError: (message: string) => void;
}) {
  return (
    <NoteContextMenu
      note={note}
      workspaces={workspaces}
      onOpen={onOpen}
      onDelete={onDelete}
      onError={onError}
    >
      <li
        data-row-enter={isNew ? "" : undefined}
        data-dashboard-enter={isNew ? undefined : ""}
        className={cn(
          "relative",
          isNew
            ? "animate-row-in motion-reduce:animate-none"
            : "animate-dashboard-enter motion-reduce:animate-none"
        )}
        style={
          isNew
            ? undefined
            : { animationDelay: `${Math.min(entranceIndex, 6) * 40 + 355}ms` }
        }
      >
        {isNew && (
          <span
            aria-hidden="true"
            data-row-flash=""
            className="pointer-events-none absolute inset-0 animate-row-flash bg-accent/10 motion-reduce:hidden"
          />
        )}
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

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-subtle-foreground">
                {NOTE_TYPE_LABEL[note.type] ?? "Nota"}
              </span>

              {note.workspaceName && (
                <>
                  <Separator />
                  <span className="text-[11px] text-subtle-foreground">
                    {note.workspaceName}
                  </span>
                </>
              )}

              {note.source === "ai" && (
                <>
                  <Separator />
                  <span
                    className="flex items-center gap-1 text-[11px] text-subtle-foreground"
                    title="Criada pela Nexo — você pode editar ou desfazer"
                  >
                    <Sparkles className="size-3" aria-hidden="true" />
                    pela Nexo
                  </span>
                </>
              )}

              {note.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    TAG_TONE[tag.color ?? ""] ??
                    "bg-secondary text-muted-foreground"
                  }`}
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
          </div>
        </button>
      </li>
    </NoteContextMenu>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-[11px] text-border">
      ·
    </span>
  );
}
