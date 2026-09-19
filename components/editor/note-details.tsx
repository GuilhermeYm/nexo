"use client";

import {
  Check,
  ChevronRight,
  FolderClosed,
  LayoutGrid,
  Paperclip,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { FloatingPanel } from "@/components/editor/floating-panel";
import {
  describeSource,
  readStored,
  subscribeStorage,
  writeStored,
} from "@/components/editor/note-source-panel";
import { NoteTags, type EditableTag } from "@/components/editor/note-tags";
import type { EditableNote } from "@/lib/notes/queries";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "nexo-note-details-collapsed";

export interface FolderChoice {
  id: string;
  name: string;
}

/**
 * A ficha da nota: origem, tags, pasta e lousas, entre o título e o corpo.
 *
 * **Recolhível.** Aberta, é uma `dl` com rótulo à esquerda e valor à direita;
 * recolhida, vira uma linha só com o resumo — "relatorio.pdf · 3 tags ·
 * Estudos · 2 lousas" — e o texto sobe. A escolha é do aparelho
 * (`nexo-note-details-collapsed`), como o painel do arquivo: quem recolheu
 * numa nota encontra recolhido na próxima.
 *
 * **O papel ignora a escolha.** Recolher é arrumação da tela; no PDF a ficha
 * sai sempre inteira (`hidden print:grid`). Pasta e lousas são organização
 * interna da conta e não vão para o papel — origem e tags vão.
 */
export function NoteDetails({
  note,
  tagVocabulary,
  folders,
  sourceOpen,
  onToggleSource,
}: {
  note: EditableNote;
  tagVocabulary: EditableTag[];
  folders: FolderChoice[];
  sourceOpen: boolean;
  onToggleSource: () => void;
}) {
  const collapsed = useSyncExternalStore(
    subscribeStorage,
    () => readStored(COLLAPSED_KEY) === "1",
    () => false
  );
  const [tagCount, setTagCount] = useState(note.tags.length);
  const [folder, setFolder] = useState(note.folder);
  const listId = useId();

  const summary = [
    note.attachment?.filename,
    tagCount > 0 ? plural(tagCount, "tag", "tags") : null,
    folder?.name,
    note.boards.length > 0
      ? plural(note.boards.length, "workspace", "workspaces")
      : null,
  ].filter(Boolean);

  return (
    <div className="mt-5 font-sans">
      <button
        type="button"
        onClick={() => writeStored(COLLAPSED_KEY, collapsed ? "0" : "1")}
        aria-expanded={!collapsed}
        aria-controls={listId}
        className="-ml-2 flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-xs text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground motion-reduce:transition-none print:hidden pointer-coarse:h-9"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none",
            !collapsed && "rotate-90"
          )}
        />
        <span className="shrink-0 font-medium">Detalhes</span>
        {collapsed && summary.length > 0 && (
          <span className="min-w-0 truncate">
            <span aria-hidden="true" className="mr-1.5">
              ·
            </span>
            {summary.join(" · ")}
          </span>
        )}
      </button>

      <dl
        id={listId}
        className={cn(
          "mt-1.5 grid-cols-[5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[5.5rem_minmax(0,1fr)] print:mt-0 print:grid",
          collapsed ? "hidden" : "grid"
        )}
      >
        {note.attachment && (
          <>
            <dt className="flex h-7 items-center text-xs text-subtle-foreground pointer-coarse:h-9">
              Origem
            </dt>
            <dd className="min-w-0">
              <button
                type="button"
                onClick={onToggleSource}
                aria-pressed={sourceOpen}
                title={
                  sourceOpen
                    ? "Fechar o arquivo de origem"
                    : "Ver o arquivo ao lado da nota"
                }
                className="-ml-2 inline-flex h-7 max-w-full items-center gap-2 rounded-md px-2 text-xs text-foreground transition-colors duration-150 hover:bg-tertiary motion-reduce:transition-none pointer-coarse:h-9"
              >
                <Paperclip
                  className="size-3.5 shrink-0 text-subtle-foreground"
                  aria-hidden="true"
                />
                <span className="truncate font-medium">
                  {note.attachment.filename}
                </span>
                <span className="shrink-0 tabular-nums text-subtle-foreground">
                  {describeSource(note.attachment)}
                </span>
              </button>
            </dd>
          </>
        )}

        <NoteTags
          noteId={note.id}
          initialTags={note.tags}
          vocabulary={tagVocabulary}
          onCountChange={setTagCount}
        />

        <dt className="flex h-7 items-center text-xs text-subtle-foreground print:hidden pointer-coarse:h-9">
          Pasta
        </dt>
        <dd className="min-w-0 print:hidden">
          <FolderPicker
            noteId={note.id}
            folder={folder}
            folders={folders}
            onChange={setFolder}
          />
        </dd>

        <dt className="flex h-7 items-center text-xs text-subtle-foreground print:hidden pointer-coarse:h-9">
          Workspaces
        </dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-1.5 print:hidden">
          {note.boards.length === 0 ? (
            <span className="flex h-7 items-center text-xs text-subtle-foreground pointer-coarse:h-9">
              Em nenhum workspace
            </span>
          ) : (
            note.boards.map((board) => (
              <Link
                key={board.workspaceId}
                href={`/workspace/${board.workspaceId}?focus=${board.windowId}`}
                title={`Abrir "${board.name}" com a nota em foco`}
                className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-foreground transition-colors duration-150 hover:bg-tertiary motion-reduce:transition-none pointer-coarse:h-9"
              >
                <LayoutGrid
                  className="size-3.5 shrink-0 text-subtle-foreground"
                  aria-hidden="true"
                />
                <span className="truncate">{board.name}</span>
              </Link>
            ))
          )}
        </dd>
      </dl>
    </div>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * A pasta da nota, trocável ali mesmo. Mesma rota do inventário e do trilho
 * (`PUT /api/notes/[id]/folder`): escolher aqui conta como escolha da
 * pessoa, e a organização da IA não mexe mais nesta nota.
 *
 * Otimista — a pasta troca na hora e volta se a rota recusar.
 */
function FolderPicker({
  noteId,
  folder,
  folders,
  onChange,
}: {
  noteId: string;
  folder: FolderChoice | null;
  folders: FolderChoice[];
  onChange: (folder: FolderChoice | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  async function choose(next: FolderChoice | null) {
    close();
    anchorRef.current?.focus();
    if ((next?.id ?? null) === (folder?.id ?? null)) return;

    const previous = folder;
    onChange(next);
    setError(false);
    try {
      const response = await fetch(`/api/notes/${noteId}/folder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: next?.id ?? null }),
      });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      onChange(previous);
      setError(true);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Trocar a pasta da nota"
        className={cn(
          "-ml-2 inline-flex h-7 max-w-full items-center gap-2 rounded-md px-2 text-xs transition-colors duration-150 hover:bg-tertiary motion-reduce:transition-none pointer-coarse:h-9",
          folder ? "text-foreground" : "text-subtle-foreground",
          open && "bg-tertiary"
        )}
      >
        <FolderClosed
          className="size-3.5 shrink-0 text-subtle-foreground"
          aria-hidden="true"
        />
        <span className="truncate font-medium">
          {folder?.name ?? "Sem pasta"}
        </span>
      </button>
      {error && (
        <span role="status" className="text-xs text-error">
          Não deu para mover a nota.
        </span>
      )}

      <FloatingPanel
        anchorRef={anchorRef}
        open={open}
        onClose={close}
        label="Pasta da nota"
        className="w-60 p-1"
      >
        <ul className="flex max-h-64 flex-col overflow-y-auto">
          <FolderOption
            label="Sem pasta"
            muted
            selected={folder === null}
            onPick={() => choose(null)}
          />
          {folders.map((option) => (
            <FolderOption
              key={option.id}
              label={option.name}
              selected={folder?.id === option.id}
              onPick={() => choose(option)}
            />
          ))}
        </ul>
        {folders.length === 0 && (
          <p className="px-2.5 pt-1 pb-2 text-xs leading-relaxed text-subtle-foreground">
            Você ainda não tem pastas. Elas se criam no trilho do dashboard.
          </p>
        )}
        {folder && (
          <Link
            href={`/dashboard/notas?folder=${folder.id}`}
            className="mt-1 block rounded-lg border-t border-border px-2.5 pt-2 pb-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            Ver as notas de “{folder.name}”
          </Link>
        )}
      </FloatingPanel>
    </div>
  );
}

function FolderOption({
  label,
  selected,
  muted = false,
  onPick,
}: {
  label: string;
  selected: boolean;
  muted?: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onPick}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-tertiary motion-reduce:transition-none",
          muted ? "text-subtle-foreground" : "text-foreground",
          selected && "bg-tertiary"
        )}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {selected && <Check className="size-4 shrink-0" aria-hidden="true" />}
      </button>
    </li>
  );
}
