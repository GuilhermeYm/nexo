"use client";

import {
  ChevronRight,
  ExternalLink,
  FolderClosed,
  FolderOpen,
  Inbox,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { NoteContextMenu, useNoteDeletion } from "@/components/dashboard/note-context-menu";
import { NoteTypeIcon } from "@/components/dashboard/note-type-icon";
import { DeleteTagsChoice } from "@/components/notes/delete-tags-choice";
import { CreateFolderDialog } from "@/components/notes/create-folder-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { WorkspaceSummary } from "@/lib/dashboard/queries";
import type { FolderItem } from "@/lib/folders/types";
import type { NoteDeletionImpact } from "@/lib/notes/deletion-impact";
import type { NoteListItem } from "@/lib/notes/list";
import { cn } from "@/lib/utils";

/** Quantas notas uma pasta aberta mostra no trilho antes de "Ver todas". */
const NOTES_PER_FOLDER = 8;

/** A pasta "Sem pasta": as notas que não estão em pasta nenhuma. */
const UNFILED = "none";

/**
 * As pastas de notas no trilho, cada uma abrindo as próprias notas.
 *
 * As notas de uma pasta só são buscadas quando ela abre, e uma vez: a lista
 * completa, com filtros e busca, é `/dashboard/notas?folder=`. O trilho é o
 * atalho, não um segundo inventário.
 *
 * As pastas são relidas quando a aba volta a ficar visível: a organização
 * pela Nexo e as mudanças em Notas acontecem em outra tela.
 *
 * O botão direito na pasta abre o mesmo tipo de menu dos workspaces, com as
 * duas maneiras de apagar. "Sem pasta" não tem menu: não é uma pasta, é o
 * resto. E cada nota lá dentro abre o `NoteContextMenu` — o mesmo menu de
 * "Recentes", porque é a mesma nota vista de outro lugar.
 */
export function SidebarFolders({
  labelsVisible,
  onCloseDrawer,
  workspaces,
}: {
  labelsVisible: boolean;
  onCloseDrawer: () => void;
  /** Alimenta o submenu "Abrir no workspace" das notas. */
  workspaces: WorkspaceSummary[];
}) {
  const router = useRouter();
  const [folders, setFolders] = useState<FolderItem[] | null>(null);
  /** O que deu errado na última exclusão, dito na própria lista. */
  const [notice, setNotice] = useState<string | null>(null);
  /** A pasta cujas notas estão prestes a ir junto, e o que sai com elas. */
  const [purging, setPurging] = useState<{ id: string; name: string; count: number } | null>(
    null
  );
  const [purgeTags, setPurgeTags] = useState(false);
  const [purgeImpact, setPurgeImpact] = useState<NoteDeletionImpact | null>(null);
  const [impactStatus, setImpactStatus] = useState<"idle" | "loading" | "error">("idle");
  const [purgingNow, setPurgingNow] = useState(false);
  const [failed, setFailed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  /** Notas já buscadas por pasta; relidas junto com as pastas. */
  const [notesByFolder, setNotesByFolder] = useState<
    Record<string, { notes: NoteListItem[]; total: number } | "loading" | "error">
  >({});
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const loadNotes = useCallback(async (folderId: string) => {
    setNotesByFolder((current) =>
      current[folderId] && current[folderId] !== "error"
        ? current
        : { ...current, [folderId]: "loading" }
    );
    try {
      const params = new URLSearchParams({ folder: folderId, sort: "updated" });
      const response = await fetch(`/api/notes?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("folder notes request failed");
      const body = (await response.json()) as { notes: NoteListItem[]; total: number };
      setNotesByFolder((current) => ({
        ...current,
        [folderId]: { notes: body.notes.slice(0, NOTES_PER_FOLDER), total: body.total },
      }));
    } catch {
      setNotesByFolder((current) => ({ ...current, [folderId]: "error" }));
    }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const response = await fetch("/api/folders", { cache: "no-store" });
      if (!response.ok) throw new Error("folders request failed");
      const body = (await response.json()) as { folders: FolderItem[] };
      setFolders(body.folders);
      setFailed(false);
      // O que estava aberto é relido junto: a Nexo pode ter mudado o conteúdo.
      for (const id of openRef.current) void loadNotes(id);
    } catch {
      setFailed(true);
    }
  }, [loadNotes]);

  // Um diálogo de exclusão para o trilho inteiro, não um por nota listada.
  // Recarregar as pastas já relê as notas de cada pasta aberta, então não
  // importa em qual delas a nota excluída estava.
  const deletion = useNoteDeletion({
    onDeleted: () => {
      void loadFolders();
      router.refresh();
    },
    onError: setNotice,
  });

  useEffect(() => {
    const first = setTimeout(() => void loadFolders(), 0);
    function onVisible() {
      if (document.visibilityState === "visible") void loadFolders();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadFolders]);

  function toggle(folderId: string) {
    const willOpen = !open.has(folderId);
    setOpen((current) => {
      const next = new Set(current);
      if (willOpen) next.add(folderId);
      else next.delete(folderId);
      return next;
    });
    if (willOpen && !notesByFolder[folderId]) void loadNotes(folderId);
  }

  /**
   * Apaga a pasta — com ou sem as notas de dentro.
   *
   * A lista é relida do servidor em vez de remendada aqui: apagar com as
   * notas mexe na contagem de "Sem pasta" também, e adivinhar esse número
   * no cliente seria mostrar um total que não é o do banco.
   */
  async function removeFolder(
    folderId: string,
    withNotes: boolean,
    withTags = false
  ) {
    setNotice(null);
    const response = await fetch(`/api/folders/${folderId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notes: withNotes ? "delete" : "keep",
        tags: withNotes && withTags,
      }),
    }).catch(() => null);

    if (!response?.ok) {
      setNotice(response ? "Não deu para apagar a pasta." : "Sem conexão.");
      return;
    }

    setOpen((current) => {
      const next = new Set(current);
      next.delete(folderId);
      return next;
    });
    setNotesByFolder((current) => {
      const next = { ...current };
      delete next[folderId];
      return next;
    });
    await loadFolders();
    // A tela de Notas pode estar filtrada por esta pasta, ou listando uma
    // nota que acabou de ir embora.
    router.refresh();
  }

  /**
   * Mede o que sai junto com as notas da pasta.
   *
   * O alvo vai como `folderId`, não como a lista de notas: o trilho só
   * carregou as primeiras de cada pasta, e mandar o que ele tem em mãos
   * mediria o impacto de um pedaço.
   */
  async function loadPurgeImpact(folderId: string) {
    setImpactStatus("loading");
    try {
      const response = await fetch("/api/notes/deletion-impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      if (!response.ok) throw new Error("impact request failed");
      const next = (await response.json()) as NoteDeletionImpact;
      setPurgeImpact(next);
      if (next.tags.length === 0) setPurgeTags(false);
      setImpactStatus("idle");
    } catch {
      setImpactStatus("error");
    }
  }

  async function confirmPurge() {
    if (!purging) return;
    setPurgingNow(true);
    await removeFolder(purging.id, true, purgeTags);
    setPurgingNow(false);
    setPurging(null);
  }

  if (failed && folders === null) {
    return labelsVisible ? (
      <p className="px-[9px] py-2 text-xs leading-relaxed text-subtle-foreground">
        As pastas não carregaram.{" "}
        <button
          type="button"
          onClick={() => void loadFolders()}
          className="font-medium text-foreground underline decoration-border underline-offset-4"
        >
          Tentar de novo
        </button>
      </p>
    ) : null;
  }

  if (folders === null) {
    return (
      <ul aria-hidden="true" className="flex flex-col gap-0.5">
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex h-9 items-center gap-3 px-[9px]">
            <span className="size-4 shrink-0 rounded bg-tertiary" />
            {labelsVisible && (
              <span
                className="h-3 animate-pulse rounded bg-tertiary motion-reduce:animate-none"
                style={{ width: `${62 - row * 14}%` }}
              />
            )}
          </li>
        ))}
      </ul>
    );
  }

  const rows: { id: string; name: string; count: number | null }[] = [
    ...folders.map((folder) => ({ id: folder.id, name: folder.name, count: folder.noteCount })),
    { id: UNFILED, name: "Sem pasta", count: null },
  ];

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="min-h-24 rounded-lg">
      <ul className="flex flex-col gap-0.5">
      {notice && labelsVisible && (
        <li role="alert" className="px-[9px] pb-1 text-xs leading-relaxed text-error">
          {notice}
        </li>
      )}
      {folders.length === 0 && labelsVisible && (
        <li className="px-[9px] pb-1 text-xs leading-relaxed text-subtle-foreground">
          Nenhuma pasta ainda. Crie em{" "}
          <Link
            href="/dashboard/notas"
            onClick={onCloseDrawer}
            className="font-medium text-foreground underline decoration-border underline-offset-4"
          >
            Notas
          </Link>{" "}
          ou peça para a Nexo organizar.
        </li>
      )}
      {rows.map((row) => {
        const isOpen = open.has(row.id);
        const href = `/dashboard/notas?folder=${row.id}`;
        const Icon = row.id === UNFILED ? Inbox : isOpen ? FolderOpen : FolderClosed;

        // Recolhido, o trilho não tem espaço para uma árvore: a pasta vira
        // atalho direto para a lista filtrada.
        if (!labelsVisible) {
          return (
            <li key={row.id}>
              <Link
                href={href}
                title={row.name}
                className="flex h-9 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-tertiary/60 hover:text-foreground"
              >
                <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                <span className="sr-only">{row.name}</span>
              </Link>
            </li>
          );
        }

        const state = notesByFolder[row.id];
        const count = row.count ?? 0;
        // "Sem pasta" é uma vista, não uma linha de `folders`: não existe
        // pasta para apagar ali, então ela não ganha menu.
        const isFolder = row.id !== UNFILED;

        return (
          <li key={row.id}>
            <ContextMenu>
              <ContextMenuTrigger asChild disabled={!isFolder}>
                <div className="group/folder relative">
                  <button
                    type="button"
                    onClick={() => toggle(row.id)}
                    aria-expanded={isOpen}
                    className="flex h-9 w-full items-center gap-2 rounded-lg pr-2 pl-[5px] text-left text-muted-foreground transition-colors duration-150 hover:bg-tertiary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150 motion-reduce:transition-none",
                        isOpen && "rotate-90"
                      )}
                      aria-hidden="true"
                    />
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                    {row.count !== null && (
                      <span
                        className={cn(
                          "shrink-0 text-xs tabular-nums text-subtle-foreground",
                          // A contagem cede o lugar ao "⋯", como nos
                          // workspaces: os dois moram no mesmo canto.
                          "transition-opacity duration-150 group-hover/folder:opacity-0 group-focus-within/folder:opacity-0 motion-reduce:transition-none"
                        )}
                      >
                        {row.count}
                      </span>
                    )}
                  </button>

                  {/* O "⋯" existe por descoberta: quem nunca tentou o botão
                      direito numa lista precisa ver que há algo ali. Ele
                      dispara o mesmo menu de contexto na própria linha, então
                      há um menu só, num lugar só do código. */}
                  {isFolder && (
                    <button
                      type="button"
                      onClick={(event) => {
                        const box = event.currentTarget.getBoundingClientRect();
                        event.currentTarget.parentElement?.dispatchEvent(
                          new MouseEvent("contextmenu", {
                            bubbles: true,
                            clientX: box.left,
                            clientY: box.bottom,
                          })
                        );
                      }}
                      aria-label={`Opções de ${row.name}`}
                      className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-subtle-foreground opacity-0 transition-opacity duration-150 hover:bg-background hover:text-foreground group-hover/folder:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
                    >
                      <MoreHorizontal className="size-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </ContextMenuTrigger>

              {isFolder && (
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => {
                      onCloseDrawer();
                      router.push(href);
                    }}
                  >
                    <ExternalLink className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
                    <ContextMenuItemLabel label="Abrir em Notas" />
                  </ContextMenuItem>

                  <ContextMenuSeparator />

                  <ContextMenuItem
                    destructive
                    confirmLabel="Apagar só a pasta"
                    onSelect={() => void removeFolder(row.id, false)}
                  >
                    <Trash2 className="mt-0.5 size-4 shrink-0" />
                    <ContextMenuItemLabel
                      label="Apagar a pasta"
                      hint={
                        count === 0
                          ? "A pasta está vazia."
                          : `${count} nota${count > 1 ? "s voltam" : " volta"} para “Sem pasta”.`
                      }
                    />
                  </ContextMenuItem>

                  {/* Só aparece quando há o que apagar junto: numa pasta
                      vazia as duas opções fariam a mesma coisa, e a mais
                      perigosa não deve existir sem motivo. */}
                  {count > 0 && (
                    <ContextMenuItem
                      destructive
                      confirmLabel="Escolher o que vai junto"
                      onSelect={() => {
                        setPurgeTags(false);
                        setPurgeImpact(null);
                        setPurging({ id: row.id, name: row.name, count });
                        void loadPurgeImpact(row.id);
                      }}
                    >
                      <Trash2 className="mt-0.5 size-4 shrink-0" />
                      <ContextMenuItemLabel
                        label="Apagar com as notas"
                        hint={`${count} nota${count > 1 ? "s saem" : " sai"} da sua conta junto com a pasta.`}
                      />
                    </ContextMenuItem>
                  )}
                </ContextMenuContent>
              )}
            </ContextMenu>

            {isOpen && (
              <div className="mb-1 ml-[18px] border-l border-border pl-2">
                {state === "loading" || state === undefined ? (
                  <p className="py-1.5 pl-2 text-xs text-subtle-foreground">Carregando…</p>
                ) : state === "error" ? (
                  <button
                    type="button"
                    onClick={() => void loadNotes(row.id)}
                    className="py-1.5 pl-2 text-left text-xs text-subtle-foreground underline decoration-border underline-offset-4 hover:text-foreground"
                  >
                    Não carregou. Tentar de novo
                  </button>
                ) : state.notes.length === 0 ? (
                  <p className="py-1.5 pl-2 text-xs text-subtle-foreground">Nenhuma nota aqui.</p>
                ) : (
                  <ul className="flex flex-col">
                    {state.notes.map((note) => (
                      <NoteContextMenu
                        key={note.id}
                        note={note}
                        workspaces={workspaces}
                        onOpen={() => {
                          onCloseDrawer();
                          router.push(`/nota/${note.id}`);
                        }}
                        onDelete={deletion.request}
                        onError={setNotice}
                      >
                        <li>
                          <Link
                            href={`/nota/${note.id}`}
                            onClick={onCloseDrawer}
                            title={note.title}
                            className="flex h-8 items-center gap-2 rounded-md px-2 text-muted-foreground transition-colors duration-150 hover:bg-tertiary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:h-10"
                          >
                            <NoteTypeIcon
                              type={note.type}
                              className="size-3.5 shrink-0 text-subtle-foreground"
                            />
                            <span className="truncate text-[13px]">{note.title}</span>
                          </Link>
                        </li>
                      </NoteContextMenu>
                    ))}
                    {state.total > state.notes.length && (
                      <li>
                        <Link
                          href={href}
                          onClick={onCloseDrawer}
                          className="flex h-8 items-center px-2 text-xs font-medium text-subtle-foreground transition-colors hover:text-foreground pointer-coarse:h-10"
                        >
                          Ver todas as {state.total}
                        </Link>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </li>
        );
      })}
      {labelsVisible && (
        <li className="pt-1">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-lg px-[9px] text-sm font-medium text-subtle-foreground transition-colors hover:bg-tertiary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Plus className="size-4" aria-hidden="true" />
            Nova pasta
          </button>
        </li>
      )}
      </ul>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
            <ContextMenuItemLabel
              label="Criar nova pasta"
              hint="Adiciona uma pasta à sua conta."
            />
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {deletion.dialog}

      <CreateFolderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void loadFolders();
          router.refresh();
        }}
      />

      {/* Apagar a pasta com as notas abre diálogo — as outras escolhas do
          menu não. É aqui que mora a pergunta sobre as tags, que são globais
          e não caberiam num rótulo de menu. */}
      <ConfirmDialog
        open={purging !== null}
        title="Apagar a pasta e as notas?"
        description="As notas saem da sua conta, da busca e de todas as lousas em que estiverem abertas."
        subject={
          purging
            ? `${purging.name} · ${purging.count} ${purging.count === 1 ? "nota" : "notas"}`
            : undefined
        }
        confirmLabel="Apagar tudo"
        busyLabel="Apagando…"
        busy={purgingNow}
        error={notice ?? undefined}
        onOpenChange={(open) => {
          if (!open && !purgingNow) setPurging(null);
        }}
        onConfirm={() => void confirmPurge()}
      >
        <DeleteTagsChoice
          impact={purgeImpact}
          status={impactStatus}
          checked={purgeTags}
          disabled={purgingNow}
          onCheckedChange={setPurgeTags}
          onRetry={() => {
            if (purging) void loadPurgeImpact(purging.id);
          }}
          subject={{
            these: "destas notas",
            outside: "da pasta",
            empty: "As notas desta pasta não têm tags para apagar.",
            only: "Só nesta pasta",
          }}
        />
      </ConfirmDialog>
    </>
  );
}
