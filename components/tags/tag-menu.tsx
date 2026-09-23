"use client";

import { Palette, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { RecentNote } from "@/lib/dashboard/queries";

/** O mínimo que o menu precisa saber da tag. */
export interface TagMenuTarget {
  id: string;
  name: string;
}

/** O alvo no grafo: além do nome, a cor e onde o botão direito aconteceu. */
export interface GraphTagMenuTarget extends TagMenuTarget {
  color: string | null;
  clientX: number;
  clientY: number;
}

type DeletionPhase =
  | { kind: "checking" }
  /** Há outras notas com a tag: o aviso existe só neste caso. */
  | { kind: "ready"; others: RecentNote[] }
  | { kind: "deleting" }
  | { kind: "error"; stage: "check" | "delete" };

/**
 * O menu de uma tag e o fluxo de apagar.
 *
 * **Um componente, dois lugares** — o chip no editor/ficha e o nó de tag no
 * grafo de `/dashboard/tags`. Os dois nascem de um botão direito que, até
 * aqui, não abria nada nas tags: só as notas tinham menu. O conteúdo do menu
 * (`TagMenuContent`) e a confirmação (`useTagDeletion`) moram juntos porque
 * a pergunta é a mesma nos dois: apagar tag é apagar da **conta**, não da
 * nota que está na tela.
 *
 * **O aviso aparece só quando há outras notas.** A tag é global: o mesmo
 * nome marca quantas notas quiser. Se ela só existe na nota de onde o menu
 * abriu (`currentNoteId`), não há o que avisar — o fluxo confere o impacto
 * (a diálogo de "Verificando…" é o estado de espera, não um aviso) e apaga
 * direto. Se outras notas usam a mesma tag, a segunda tela lista quais
 * são — o mesmo aviso de "notas relacionadas" de apagar nota, com o mesmo
 * motivo: marcar sem ver isso seria apagar de outras notas sem saber.
 *
 * `prime()` mede o impacto **quando o menu abre**, para a segunda confirmação
 * não esperar um fetch. O resultado fica na memória do hook — uma tag muda
 * de uso pouco, e uma falha limpa o cache para a tentativa seguinte reler.
 */
export function useTagDeletion({
  currentNoteId = null,
  onDeleted,
}: {
  /** De qual nota veio o pedido; a lista do aviso fica só com as outras. */
  currentNoteId?: string | null;
  onDeleted?: (tagId: string) => void;
}) {
  const [target, setTarget] = useState<TagMenuTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<DeletionPhase>({ kind: "checking" });
  const notesCache = useRef(new Map<string, Promise<RecentNote[]>>());

  const loadNotes = useCallback(async (tagId: string): Promise<RecentNote[]> => {
    const cached = notesCache.current.get(tagId);
    if (cached) return cached;

    const request = fetch(`/api/tags/${tagId}/notes`).then(
      async (response) => {
        if (!response.ok) throw new Error("tag notes request failed");
        const body = (await response.json()) as { notes: RecentNote[] };
        return body.notes;
      }
    );
    notesCache.current.set(tagId, request);
    // Erro não fica preso no cache: a próxima tentativa relê de verdade.
    void request.catch(() => notesCache.current.delete(tagId));
    return request;
  }, []);

  async function remove(tag: TagMenuTarget) {
    setPhase({ kind: "deleting" });
    try {
      const response = await fetch(`/api/tags/${tag.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete tag request failed");
      setTarget(null);
      setOpen(false);
      onDeleted?.(tag.id);
    } catch {
      setPhase({ kind: "error", stage: "delete" });
    }
  }

  async function check(tag: TagMenuTarget) {
    try {
      const notes = await loadNotes(tag.id);
      const others = notes.filter((note) => note.id !== currentNoteId);
      if (others.length === 0) {
        // Sem outra nota com a mesma tag não há aviso a fazer: apaga direto.
        await remove(tag);
        return;
      }
      setPhase({ kind: "ready", others });
    } catch {
      setPhase({ kind: "error", stage: "check" });
    }
  }

  function request(tag: TagMenuTarget) {
    setTarget(tag);
    setPhase({ kind: "checking" });
    setOpen(true);
    void check(tag);
  }

  /** Mede o impacto quando o menu abre, esquentando o cache. */
  const prime = useCallback(
    (tag: TagMenuTarget) => {
      void loadNotes(tag.id).catch(() => {
        // Falha silenciosa aqui: o `check` do pedido é quem mostra o erro.
      });
    },
    [loadNotes]
  );

  function onConfirm() {
    if (!target) return;
    if (phase.kind === "ready") void remove(target);
    else if (phase.kind === "error") {
      setPhase({ kind: "checking" });
      void check(target);
    }
  }

  const dialog = target ? (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Apagar a tag?"
      subject={`#${target.name}`}
      description={
        phase.kind === "ready"
          ? "A tag pertence à conta: apagar tira ela de todas as notas que a usam."
          : phase.kind === "deleting"
            ? "Apagando a tag da sua conta…"
            : phase.kind === "error"
              ? phase.stage === "check"
                ? "Não foi possível verificar onde esta tag é usada."
                : "Não foi possível apagar a tag."
              : "Verificando onde esta tag é usada…"
      }
      confirmLabel={phase.kind === "error" ? "Tentar de novo" : "Apagar tag"}
      busyLabel={phase.kind === "deleting" ? "Apagando…" : "Verificando…"}
      busy={phase.kind === "checking" || phase.kind === "deleting"}
      error={phase.kind === "error" ? "Tente de novo em instantes." : undefined}
      onConfirm={onConfirm}
    >
      {phase.kind === "ready" && (
        <>
          <p className="text-xs leading-relaxed text-error">
            Atenção:{" "}
            {currentNoteId
              ? `a tag também está em ${phase.others.length} ${
                  phase.others.length === 1 ? "outra nota" : "outras notas"
                }.`
              : `a tag está em ${phase.others.length} ${
                  phase.others.length === 1 ? "nota" : "notas"
                }.`}{" "}
            Ao apagá-la, essas notas também ficarão sem ela.
          </p>
          <ul
            className="mt-3 max-h-44 space-y-1.5 overflow-y-auto pr-1"
            aria-label="Notas que usam esta tag"
          >
            {phase.others.map((note) => (
              <li
                key={note.id}
                className="truncate rounded-lg bg-secondary px-3 py-2 text-xs text-foreground"
              >
                {note.title.trim() || "Sem título"}
              </li>
            ))}
          </ul>
        </>
      )}
    </ConfirmDialog>
  ) : null;

  return { request, prime, dialog };
}

/**
 * O conteúdo do menu: editar (quando quem chama tem o que editar) e apagar.
 *
 * Apagar é `destructive` — dois cliques dentro do próprio menu, como o
 * "Excluir" das notas. Um diálogo a mais só para quem já passou por um menu
 * de uma linha seria uma confirmação atrás da outra; aqui o diálogo existe
 * porque carrega o **aviso das outras notas**, que só existe quando o impacto
 * pede.
 */
export function TagMenuContent({
  tag,
  onEdit,
  editLabel = "Editar a tag",
  onDelete,
  container,
  className,
}: {
  tag: TagMenuTarget;
  /** O painel de nome/cor — o mesmo que o clique esquerdo abre. */
  onEdit?: () => void;
  editLabel?: string;
  onDelete: () => void;
  /** O `<dialog>` mais próximo, quando o menu nasce dentro de um. */
  container?: HTMLElement;
  className?: string;
}) {
  return (
    <ContextMenuContent container={container} className={className}>
      <p className="truncate px-2.5 pt-1.5 pb-1 text-xs font-medium text-subtle-foreground">
        #{tag.name}
      </p>

      {onEdit && (
        <>
          <ContextMenuItem onSelect={onEdit}>
            <Palette className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
            <ContextMenuItemLabel label={editLabel} />
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}

      <ContextMenuItem destructive confirmLabel="Apagar" onSelect={onDelete}>
        <Trash2 className="mt-0.5 size-4 shrink-0" />
        <ContextMenuItemLabel label="Apagar tag" hint="Vale para todas as notas" />
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/**
 * O menu da tag no grafo.
 *
 * Mesmo truque do `TagGraphNoteMenu`: o canvas não tem elemento por nó, então
 * o gatilho é um ponto invisível e o grafo pede a abertura com um
 * `contextmenu` sintético — o menu nasce onde o botão direito aconteceu.
 * Não modal, pelo mesmo motivo de lá: o modal desliga `pointer-events` do
 * canvas e o hover se perde.
 */
export function TagGraphTagMenu({
  target,
  onEditColor,
  onDeleted,
}: {
  /** Um alvo novo abre o menu; o mesmo objeto não reabre. */
  target: GraphTagMenuTarget | null;
  /** Abrir o editor de cor do nó, já com a tag certa selecionada. */
  onEditColor: (tag: { id: string; name: string; color: string | null }) => void;
  /** O grafo se redesenha e mostra o recado. */
  onDeleted: (tagId: string) => void;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const { prime, request, dialog } = useTagDeletion({ onDeleted });

  useEffect(() => {
    if (!target) return;
    anchorRef.current?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: target.clientX,
        clientY: target.clientY,
      })
    );
    prime(target);
  }, [target, prime]);

  return (
    <>
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
          <TagMenuContent
            tag={target}
            editLabel="Trocar a cor"
            onEdit={() => onEditColor(target)}
            onDelete={() => request(target)}
          />
        )}
      </ContextMenu>

      {dialog}
    </>
  );
}
