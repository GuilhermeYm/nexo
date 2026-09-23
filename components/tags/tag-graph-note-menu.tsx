"use client";

import { Check, FolderClosed, Hash, LoaderCircle, SquarePen, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { NoteTags, type EditableTag } from "@/components/editor/note-tags";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { FolderItem } from "@/lib/folders/types";

/** O que o grafo sabe da nota no instante do botão direito. */
export interface GraphNoteMenuTarget {
  id: string;
  title: string;
  /** As tags dela, tiradas das arestas do próprio grafo — sem nova busca. */
  tags: EditableTag[];
  clientX: number;
  clientY: number;
}

type Load<T> = { status: "loading" } | { status: "error" } | { status: "ready"; value: T };
type Settled<T> = Exclude<Load<T>, { status: "loading" }>;

/**
 * O menu de uma nota no grafo de tags: abrir, alterar a pasta, editar as tags.
 *
 * É mais enxuto que o `NoteContextMenu` da lista de propósito — quem está no
 * grafo está olhando para a organização, então o menu oferece só o que mexe
 * nela (pasta e tags) e a saída para a nota.
 *
 * **Um menu para o grafo inteiro.** O canvas não tem elemento por nó, então
 * não há onde pendurar um `ContextMenuTrigger`. O gatilho é um ponto
 * invisível, e o grafo pede a abertura com um `contextmenu` sintético nele —
 * a mesma técnica do "⋯" das pastas no trilho. O Radix posiciona o menu pelo
 * `clientX/clientY` do evento, então o menu nasce onde o botão direito
 * aconteceu.
 *
 * **Tags não moram num submenu.** Input dentro de menu briga com o Radix por
 * foco, setas e Escape; o item fecha o menu e abre um diálogo pequeno com o
 * mesmo `NoteTags` do editor.
 */
export function TagGraphNoteMenu({
  target,
  vocabulary,
  onTagsDialogClose,
  onNotice,
}: {
  /** Um alvo novo abre o menu; o mesmo objeto não reabre. */
  target: GraphNoteMenuTarget | null;
  /** As tags da conta, das mais usadas às menos — as sugestões do editor. */
  vocabulary: EditableTag[];
  /** As tags podem ter mudado: o grafo precisa se redesenhar. */
  onTagsDialogClose: () => void;
  /** Recado curto para o grafo mostrar — o canvas não muda ao trocar de pasta. */
  onNotice: (message: string, tone: "info" | "error") => void;
}) {
  const router = useRouter();
  const anchorRef = useRef<HTMLSpanElement>(null);

  // A lista de pastas muda pouco: uma busca na primeira abertura, e de novo
  // só depois de uma mudança (as contagens do submenu ficaram velhas) ou de
  // uma falha. `null` é "ainda não chegou".
  const [folders, setFolders] = useState<Settled<FolderItem[]> | null>(null);
  const foldersInFlight = useRef(false);
  const foldersTriedFor = useRef<GraphNoteMenuTarget | null>(null);
  // A pasta atual é por nota e sai da prévia autenticada (`GET /api/notes/[id]`).
  // Resposta de outra nota conta como "carregando" para esta.
  const [current, setCurrent] = useState<{
    noteId: string;
    folder: Settled<string | null>;
  } | null>(null);
  const [tagsNote, setTagsNote] = useState<GraphNoteMenuTarget | null>(null);

  useEffect(() => {
    if (!target) return;
    anchorRef.current?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: target.clientX,
        clientY: target.clientY,
      })
    );

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/notes/${target.id}`, { signal: controller.signal });
        if (!response.ok) throw new Error("note preview request failed");
        const body = (await response.json()) as { note: { folder: { id: string } | null } };
        setCurrent({
          noteId: target.id,
          folder: { status: "ready", value: body.note.folder?.id ?? null },
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setCurrent({ noteId: target.id, folder: { status: "error" } });
      }
    })();

    return () => controller.abort();
  }, [target]);

  useEffect(() => {
    if (!target || folders?.status === "ready" || foldersInFlight.current) return;
    // Uma falha só tenta de novo na próxima abertura, nunca em laço.
    if (folders?.status === "error" && foldersTriedFor.current === target) return;
    foldersInFlight.current = true;
    foldersTriedFor.current = target;

    void (async () => {
      try {
        const response = await fetch("/api/folders");
        if (!response.ok) throw new Error("folders request failed");
        const body = (await response.json()) as { folders: FolderItem[] };
        setFolders({ status: "ready", value: body.folders });
      } catch {
        setFolders({ status: "error" });
      } finally {
        foldersInFlight.current = false;
      }
    })();
  }, [target, folders]);

  async function moveTo(note: GraphNoteMenuTarget, folderId: string | null) {
    const previous = current;
    setCurrent({ noteId: note.id, folder: { status: "ready", value: folderId } });

    try {
      const response = await fetch(`/api/notes/${note.id}/folder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      if (!response.ok) throw new Error("move request failed");
      const body = (await response.json()) as { folder: { name: string } | null };
      onNotice(body.folder ? `Movida para ${body.folder.name}.` : "A nota saiu da pasta.", "info");
      // As contagens do submenu mudaram; a próxima abertura relê.
      setFolders(null);
    } catch {
      setCurrent(previous);
      onNotice("Não foi possível mover a nota. Tente de novo.", "error");
    }
  }

  const currentFolder: Load<string | null> =
    target && current?.noteId === target.id ? current.folder : { status: "loading" };

  return (
    <>
      {/* Não modal: o modal desliga `pointer-events` da página, o canvas perde
          o hover e, sem o mouse se mexer, o botão direito seguinte no mesmo
          nó chegava à lib como clique no fundo — o menu não reabria. */}
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>
          <span
            ref={anchorRef}
            aria-hidden="true"
            className="pointer-events-none fixed size-0"
            style={target ? { left: target.clientX, top: target.clientY } : undefined}
          />
        </ContextMenuTrigger>

        {target && (
          <ContextMenuContent className="max-w-72">
            <p className="truncate px-2.5 pt-1.5 pb-1 text-xs font-medium text-subtle-foreground">
              {target.title.trim() || "Sem título"}
            </p>

            <ContextMenuItem onSelect={() => router.push(`/nota/${target.id}`)}>
              <SquarePen className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
              <ContextMenuItemLabel label="Abrir a nota" />
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderClosed className="size-4 shrink-0 text-subtle-foreground" />
                <span className="min-w-0 flex-1 font-medium">Alterar a pasta</span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <FolderOptions
                  folders={folders}
                  current={currentFolder}
                  onPick={(folderId) => void moveTo(target, folderId)}
                />
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuItem onSelect={() => setTagsNote(target)}>
              <Hash className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
              <ContextMenuItemLabel
                label="Tags"
                hint={
                  target.tags.length === 0
                    ? "Nenhuma ainda"
                    : target.tags.length === 1
                      ? "1 tag"
                      : `${target.tags.length} tags`
                }
              />
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      <NoteTagsDialog
        note={tagsNote}
        vocabulary={vocabulary}
        onClose={() => {
          setTagsNote(null);
          onTagsDialogClose();
        }}
      />
    </>
  );
}

function FolderOptions({
  folders,
  current,
  onPick,
}: {
  folders: Settled<FolderItem[]> | null;
  current: Load<string | null>;
  onPick: (folderId: string | null) => void;
}) {
  if (!folders) {
    return (
      <ContextMenuItem disabled>
        <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" />
        <ContextMenuItemLabel label="Carregando as pastas…" />
      </ContextMenuItem>
    );
  }

  if (folders.status === "error") {
    return (
      <ContextMenuItem disabled>
        <ContextMenuItemLabel label="As pastas não carregaram" hint="Feche o menu e tente de novo." />
      </ContextMenuItem>
    );
  }

  // Sem saber a pasta de agora, nenhuma linha leva o check: marcar a errada
  // seria pior que não marcar nenhuma.
  const currentId = current.status === "ready" ? current.value : undefined;

  // Escolher a pasta em que ela já está só fecha o menu. Desabilitar a linha
  // apagava o check junto — justamente a informação que ela carrega.
  function pick(folderId: string | null) {
    if (currentId !== folderId) onPick(folderId);
  }

  function mark(folderId: string | null) {
    return currentId === folderId ? (
      <Check className="mt-0.5 size-4 shrink-0 text-accent" />
    ) : (
      <FolderClosed className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
    );
  }

  return (
    <>
      <ContextMenuItem onSelect={() => pick(null)}>
        {mark(null)}
        <ContextMenuItemLabel label="Sem pasta" />
      </ContextMenuItem>
      {folders.value.length > 0 && <ContextMenuSeparator />}
      {folders.value.map((folder) => (
        <ContextMenuItem key={folder.id} onSelect={() => pick(folder.id)}>
          {mark(folder.id)}
          <ContextMenuItemLabel
            label={folder.name}
            hint={`${folder.noteCount} ${folder.noteCount === 1 ? "nota" : "notas"}`}
          />
        </ContextMenuItem>
      ))}
    </>
  );
}

/**
 * O editor de tags da nota, fora do menu.
 *
 * Mesmo `<dialog>` nativo da prévia de pasta: Escape, foco preso e o fundo
 * vêm do navegador. `key` pela nota — `NoteTags` guarda as tags em estado, e
 * reaproveitar a instância de uma nota na outra mostraria os chips errados.
 */
function NoteTagsDialog({
  note,
  vocabulary,
  onClose,
}: {
  note: GraphNoteMenuTarget | null;
  vocabulary: EditableTag[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const open = note !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // O `autoFocus` do React roda antes do `showModal()`, e o navegador
      // então leva o foco ao primeiro focável — o "×". "Pronto" é o gesto
      // esperado depois de mexer nas tags.
      doneRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-visible rounded-2xl bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/45"
    >
      {note && (
        <div className="flex flex-col">
          <div className="flex items-start gap-3.5 border-b border-border p-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-subtle-foreground">
              <Hash className="size-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                Tags da nota
              </h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {note.title.trim() || "Sem título"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Fechar</span>
            </button>
          </div>

          <div className="px-5 py-4">
            <NoteTags
              key={note.id}
              noteId={note.id}
              initialTags={note.tags}
              vocabulary={vocabulary}
            />
          </div>

          <div className="flex items-center justify-end border-t border-border p-3.5">
            <button
              ref={doneRef}
              type="button"
              onClick={onClose}
              className="h-9 rounded-xl bg-accent px-3.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Pronto
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
