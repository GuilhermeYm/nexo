"use client";

import { Check, FolderClosed, FolderPlus, Hash, LayoutGrid, LoaderCircle, SquarePen, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { NoteTags, type EditableTag } from "@/components/editor/note-tags";
import { DeleteTagsChoice } from "@/components/notes/delete-tags-choice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import type { WorkspaceSummary } from "@/lib/dashboard/queries";
import type { FolderItem } from "@/lib/folders/types";
import type { NoteDeletionImpact } from "@/lib/notes/deletion-impact";
import { cn } from "@/lib/utils";

/** Os seis matizes de tag do tema, endereçados pela posição gravada no banco. */
const WORKSPACE_DOT: Record<string, string> = {
  "1": "bg-tag-1-foreground",
  "2": "bg-tag-2-foreground",
  "3": "bg-tag-3-foreground",
  "4": "bg-tag-4-foreground",
  "5": "bg-tag-5-foreground",
  "6": "bg-tag-6-foreground",
};

/** O mínimo que o menu precisa saber da nota. */
export interface NoteMenuTarget {
  id: string;
  title: string;
  tags: EditableTag[];
}

/**
 * O menu de uma nota: abrir no editor, abrir numa lousa, excluir.
 *
 * Nasceu dentro de "Recentes" e saiu de lá quando o trilho passou a listar
 * notas dentro das pastas. As duas listas mostram a mesma coisa, então
 * oferecem as mesmas saídas — e com um componente só, ganhar uma saída nova
 * é ganhá-la nos dois lugares, sem que um deles fique para trás.
 *
 * Envolve a linha (`children`), que vira o gatilho: botão direito no desktop
 * e toque longo no celular, os dois pelo Radix.
 *
 * **Excluir não mora aqui.** O menu só pede (`onDelete`); a confirmação é do
 * `useNoteDeletion`, um diálogo por lista. Com o diálogo dentro de cada
 * linha, uma lista de cem notas montava cem `<dialog>` fechados — e cem
 * cópias do estado de impacto — para, no máximo, um aberto por vez.
 */
export function NoteContextMenu({
  note,
  workspaces,
  vocabulary,
  onEditTags,
  onOpen,
  onDelete,
  onError,
  openLabel = "Abrir no editor",
  folders,
  currentFolderId,
  onMoveToFolder,
  onCreateFolder,
  hideWorkspace = false,
  children,
}: {
  note: NoteMenuTarget;
  /** Alimenta o submenu "Abrir no workspace". */
  workspaces: WorkspaceSummary[];
  /** Sugestões para editar tags; sem elas, o item não aparece. */
  vocabulary?: EditableTag[];
  onEditTags?: (note: NoteMenuTarget) => void;
  /** O clique de sempre: abrir a nota para ler e escrever. */
  onOpen: () => void;
  /** Pede a exclusão — normalmente o `request` de `useNoteDeletion`. */
  onDelete: (note: NoteMenuTarget) => void;
  /** Quem chama decide onde o recado de erro aparece. */
  onError?: (message: string) => void;
  /** Permite que uma lista use a mesma ação para abrir uma prévia. */
  openLabel?: string;
  /** Quando informadas, habilitam o submenu manual de organização. */
  folders?: FolderItem[];
  currentFolderId?: string | null;
  onMoveToFolder?: (folderId: string | null) => void;
  onCreateFolder?: () => void;
  hideWorkspace?: boolean;
  /** A linha da lista, que vira o gatilho do menu. */
  children: ReactNode;
}) {
  const router = useRouter();

  /**
   * Abre a nota numa lousa.
   *
   * A posição não é escolhida aqui: quem está numa lista não está olhando
   * para a lousa e não teria como escolher um ponto que faça sentido. O
   * servidor encaixa a janela logo abaixo do que já existe lá, e a navegação
   * leva junto o id para a lousa centralizar nela ao chegar.
   */
  async function openInWorkspace(workspaceId: string) {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/windows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "note", noteId: note.id }),
      });
      const body = await response.json().catch(() => null);

      // 409 é "já está aberta lá" — não é erro para o usuário, é destino
      // alcançado. Navegar é a resposta certa.
      if (!response.ok && response.status !== 409) {
        onError?.(body?.error ?? "Não foi possível abrir na lousa.");
        return;
      }

      router.push(
        body?.windowId
          ? `/workspace/${workspaceId}?focus=${body.windowId}`
          : `/workspace/${workspaceId}`
      );
    } catch {
      onError?.("Sem conexão. A nota não foi aberta na lousa.");
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>
          <SquarePen className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
          <ContextMenuItemLabel label={openLabel} />
        </ContextMenuItem>

        {!hideWorkspace && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <LayoutGrid className="size-4 shrink-0 text-subtle-foreground" />
              <span className="min-w-0 flex-1 font-medium">Abrir no workspace</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {workspaces.length === 0 ? (
                <ContextMenuItem disabled>
                  <ContextMenuItemLabel label="Nenhum workspace ainda" />
                </ContextMenuItem>
              ) : (
                workspaces.map((workspace) => (
                  <ContextMenuItem
                    key={workspace.id}
                    onSelect={() => void openInWorkspace(workspace.id)}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
                        WORKSPACE_DOT[workspace.color ?? ""] ?? "bg-subtle-foreground"
                      }`}
                    />
                    <ContextMenuItemLabel label={workspace.name} />
                  </ContextMenuItem>
                ))
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        {folders && onMoveToFolder && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderClosed className="size-4 shrink-0 text-subtle-foreground" />
              <span className="min-w-0 flex-1 font-medium">Organizar</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onSelect={() => onMoveToFolder(null)}>
                {currentFolderId === null ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                ) : (
                  <FolderClosed className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
                )}
                <ContextMenuItemLabel label="Sem pasta" />
              </ContextMenuItem>
              {folders.map((folder) => (
                <ContextMenuItem key={folder.id} onSelect={() => onMoveToFolder(folder.id)}>
                  {currentFolderId === folder.id ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                  ) : (
                    <FolderClosed className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
                  )}
                  <ContextMenuItemLabel
                    label={folder.name}
                    hint={`${folder.noteCount} ${folder.noteCount === 1 ? "nota" : "notas"}`}
                  />
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={onCreateFolder}>
                <FolderPlus className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
                <ContextMenuItemLabel label="Criar nova pasta…" />
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        {vocabulary && onEditTags && (
          <ContextMenuItem onSelect={() => onEditTags(note)}>
            <Hash className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
            <ContextMenuItemLabel
              label="Tags"
              hint={
                note.tags.length === 0
                  ? "Nenhuma ainda"
                  : note.tags.length === 1
                    ? "1 tag"
                    : `${note.tags.length} tags`
              }
            />
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        {/* Excluir pede confirmação: escolher arquivos e apagar tags globais
            exige contexto fora do menu. O segundo clique, como em Recentes,
            impede que um toque longo desastrado abra a confirmação sem
            intenção. */}
        <ContextMenuItem
          destructive
          confirmLabel="Excluir para valer"
          onSelect={() => onDelete(note)}
        >
          <Trash2 className="mt-0.5 size-4 shrink-0" />
          <ContextMenuItemLabel
            label="Excluir"
            hint="Sai da conta, da busca e de todas as lousas."
          />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Um editor de tags por lista: o menu só pede a abertura e pode desmontar. */
export function useNoteTagsEditor({
  vocabulary,
  onChanged,
}: {
  vocabulary: EditableTag[];
  onChanged?: (noteId: string, tags: EditableTag[]) => void;
}) {
  const [note, setNote] = useState<NoteMenuTarget | null>(null);
  const tagsRef = useRef<EditableTag[]>([]);
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

  function request(target: NoteMenuTarget) {
    tagsRef.current = target.tags;
    setNote(target);
  }

  function close() {
    if (!note) return;
    onChanged?.(note.id, tagsRef.current);
    setNote(null);
  }

  const dialog = (
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
              onClick={close}
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
              onTagsChange={(tags) => { tagsRef.current = tags; }}
            />
          </div>

          <div className="flex items-center justify-end border-t border-border p-3.5">
            <button
              ref={doneRef}
              type="button"
              onClick={close}
              className="h-9 rounded-xl bg-accent px-3.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Pronto
            </button>
          </div>
        </div>
      )}
    </dialog>
  );

  return { request, dialog };
}

/**
 * A confirmação de excluir uma nota — uma por lista, não uma por linha.
 *
 *     const deletion = useNoteDeletion({ onDeleted: refresh });
 *     <NoteContextMenu onDelete={deletion.request} … />
 *     {deletion.dialog}
 *
 * O diálogo fica montado ao lado da lista, fora do `ContextMenuContent`: o
 * Radix desmonta o conteúdo do menu ao fechar, e um diálogo lá dentro fecharia
 * junto com o menu que o abriu.
 *
 * A nota alvo continua guardada depois de fechar, para o título não sumir do
 * diálogo durante a saída. E cada pedido de impacto leva um número: quem abre
 * a nota A e logo depois a B não pode ver a resposta atrasada de A marcando as
 * caixas de B.
 */
export function useNoteDeletion({
  onDeleted,
  onError,
}: {
  /** A nota saiu da conta — a lista de quem chama precisa se refazer. */
  onDeleted: (note: NoteMenuTarget) => void;
  /** Quem chama decide onde o recado de erro aparece, além do diálogo. */
  onError?: (message: string) => void;
}) {
  const [note, setNote] = useState<NoteMenuTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [deleteAttachments, setDeleteAttachments] = useState(false);
  const [deleteTags, setDeleteTags] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** O que mais sai junto com a nota, medido no servidor. */
  const [impact, setImpact] = useState<NoteDeletionImpact | null>(null);
  const [impactStatus, setImpactStatus] = useState<"idle" | "loading" | "error">("idle");
  const impactRequest = useRef(0);

  function fail(message: string) {
    setError(message);
    onError?.(message);
  }

  /**
   * Mede o que mais sai junto: arquivos e tags.
   *
   * As duas caixas só ligam depois desta resposta. Tag é global — marcar
   * "apagar as tags" sem saber em quantas outras notas cada uma é usada
   * seria apagar coisa de fora da nota às cegas.
   */
  async function loadImpact(noteId: string) {
    const ticket = ++impactRequest.current;
    setImpactStatus("loading");
    try {
      const response = await fetch("/api/notes/deletion-impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [noteId] }),
      });
      if (!response.ok) throw new Error("impact request failed");
      const next = (await response.json()) as NoteDeletionImpact;
      if (ticket !== impactRequest.current) return;
      setImpact(next);
      if (next.attachmentCount === 0) setDeleteAttachments(false);
      if (next.tags.length === 0) setDeleteTags(false);
      setImpactStatus("idle");
    } catch {
      if (ticket === impactRequest.current) setImpactStatus("error");
    }
  }

  function request(target: NoteMenuTarget) {
    setNote(target);
    setDeleteAttachments(false);
    setDeleteTags(false);
    setImpact(null);
    setError(null);
    setOpen(true);
    void loadImpact(target.id);
  }

  async function remove() {
    if (!note) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/notes/${note.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteAttachments, deleteTags }),
      });
      if (!response.ok) {
        fail("Não foi possível excluir a nota.");
        return;
      }
      setOpen(false);
      onDeleted(note);
    } catch {
      fail("Sem conexão. A nota não foi excluída.");
    } finally {
      setDeleting(false);
    }
  }

  const dialog = (
    <ConfirmDialog
      open={open}
      title="Excluir esta nota?"
      description="Ela sairá da sua conta, da busca e de todas as lousas em que estiver aberta."
      subject={note ? note.title || "Sem título" : undefined}
      confirmLabel="Excluir nota"
      busyLabel="Excluindo nota…"
      busy={deleting}
      error={error ?? undefined}
      onOpenChange={(next) => {
        if (!next && !deleting) setOpen(false);
      }}
      onConfirm={() => void remove()}
    >
      <label
        className={cn(
          "flex items-start gap-3 rounded-xl bg-secondary px-3.5 py-3 text-sm transition-opacity",
          impact?.attachmentCount
            ? "cursor-pointer text-foreground"
            : "cursor-default text-muted-foreground opacity-70"
        )}
      >
        <input
          type="checkbox"
          checked={deleteAttachments}
          onChange={(event) => setDeleteAttachments(event.target.checked)}
          disabled={deleting || impactStatus !== "idle" || !impact?.attachmentCount}
          className="mt-0.5 size-4 accent-error"
        />
        <span>
          <span className="block font-medium">Apagar também os arquivos associados</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {impactStatus === "loading"
              ? "Verificando os arquivos desta nota…"
              : impact?.attachmentCount
                ? `${impact.attachmentCount} ${impact.attachmentCount === 1 ? "arquivo associado será removido" : "arquivos associados serão removidos"} permanentemente.`
                : impactStatus === "error"
                  ? "Não foi possível verificar os arquivos; esta opção permanece indisponível."
                  : "Esta nota não tem arquivos associados."}
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
        impact={impact}
        status={impactStatus}
        checked={deleteTags}
        disabled={deleting}
        onCheckedChange={setDeleteTags}
        onRetry={() => {
          if (note) void loadImpact(note.id);
        }}
        subject={{
          these: "desta nota",
          outside: "dela",
          empty: "Esta nota não tem tags para apagar.",
          only: "Só nesta nota",
        }}
      />
    </ConfirmDialog>
  );

  return { request, dialog };
}
