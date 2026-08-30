"use client";

import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  TAG_DOT_CLASS,
  TAG_PALETTE,
  storedChipClass,
} from "@/lib/tags/palette";
import { cn } from "@/lib/utils";

/**
 * As tags da nota, no editor — marcar, tirar, renomear e recolorir sem sair
 * da nota.
 *
 * É a mesma capacidade da janela da lousa (`TagRow` em `window-bodies.tsx`),
 * com implementação própria: aqui não há gesto de arraste da janela para
 * proteger com `stopPropagation`, e os chips seguem o tamanho do editor, não
 * o da janela. As rotas são as mesmas dos dois lados — marcar/desmarcar em
 * `/api/notes/[id]/tags`, renomear/recolorir em `/api/tags/[tagId]`.
 *
 * **A escrita é da tag, não da nota.** Renomear ou recolorir vale em todas
 * as notas marcadas, e o painel diz isso em voz alta — mesmo contrato da
 * lousa.
 *
 * **Tirar e recolorir são otimistas; adicionar não.** O chip novo precisa do
 * `id` que só o servidor conhece, então ele entra quando a resposta chega.
 *
 * **Impressão.** Os controles de edição ("+ tag", o "×") levam
 * `print:hidden` — são chrome da tela, não conteúdo da nota.
 */

export interface EditableTag {
  id: string;
  name: string;
  color: string | null;
}

export function NoteTags({
  noteId,
  initialTags,
}: {
  noteId: string;
  initialTags: EditableTag[];
}) {
  const [tags, setTags] = useState(initialTags);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const add = useCallback(
    async (name: string) => {
      try {
        const response = await fetch(`/api/notes/${noteId}/tags`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!response.ok) return;
        const body = (await response.json()) as { tag: EditableTag };
        // A rota é idempotente (`onConflictDoNothing`): marcar de novo uma
        // tag que a nota já tem não duplica o chip.
        setTags((current) =>
          current.some((tag) => tag.id === body.tag.id)
            ? current
            : [...current, body.tag]
        );
      } catch {
        // A linha simplesmente não aparece; a nota em si nunca é afetada.
      }
    },
    [noteId]
  );

  const remove = useCallback(
    async (tagId: string) => {
      // Otimista: o chip sai na hora e volta se a rota recusar.
      let previous: EditableTag[] = [];
      setTags((current) => {
        previous = current;
        return current.filter((tag) => tag.id !== tagId);
      });
      try {
        const response = await fetch(
          `/api/notes/${noteId}/tags?tagId=${tagId}`,
          { method: "DELETE" }
        );
        if (!response.ok) setTags(previous);
      } catch {
        setTags(previous);
      }
    },
    [noteId]
  );

  const update = useCallback(
    async (tagId: string, patch: { name?: string; color?: string | null }) => {
      // Otimista pelo mesmo motivo: uma amostra de cor é um gesto só, e o
      // resultado tem que se ver imediatamente.
      let previous: EditableTag[] = [];
      setTags((current) => {
        previous = current;
        return current.map((tag) =>
          tag.id === tagId ? { ...tag, ...patch } : tag
        );
      });
      try {
        const response = await fetch(`/api/tags/${tagId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!response.ok) {
          setTags(previous);
          return;
        }
        const body = (await response.json()) as { tag: EditableTag };
        setTags((current) =>
          current.map((tag) => (tag.id === tagId ? body.tag : tag))
        );
      } catch {
        setTags(previous);
      }
    },
    []
  );

  const closePanel = useCallback(() => setEditingId(null), []);

  function commit() {
    const name = value.trim();
    if (name) void add(name);
    setValue("");
    setAdding(false);
  }

  const editing = tags.find((tag) => tag.id === editingId) ?? null;

  return (
    <div className="relative mt-4 flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className={cn(
            "group/tag inline-flex max-w-56 items-center gap-1 rounded-full py-0.5 pr-1.5 pl-2 text-[11px] font-medium",
            storedChipClass(tag)
          )}
        >
          <button
            type="button"
            onClick={() =>
              setEditingId((current) => (current === tag.id ? null : tag.id))
            }
            aria-label={`Editar a tag ${tag.name}`}
            aria-expanded={editingId === tag.id}
            className="truncate"
          >
            #{tag.name}
          </button>
          <button
            type="button"
            onClick={() => void remove(tag.id)}
            aria-label={`Tirar a tag ${tag.name}`}
            className="grid size-3.5 shrink-0 place-items-center rounded-full opacity-0 transition-opacity duration-100 group-hover/tag:opacity-100 hover:bg-black/10 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100 print:hidden"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}

      {/* Ancorado na linha, não no chip — mesmo motivo da lousa: o painel
          nunca fica mais largo que a coluna da nota. */}
      {editing && (
        <TagEditPanel
          key={editing.id}
          tag={editing}
          onClose={closePanel}
          onUpdate={(patch) => void update(editing.id, patch)}
        />
      )}

      {adding ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              setValue("");
              setAdding(false);
            }
          }}
          onBlur={commit}
          placeholder="nova tag"
          maxLength={40}
          data-focus-ring="container"
          className="h-6 w-28 rounded-full border border-border bg-background px-2.5 text-[11px] text-foreground outline-none placeholder:text-subtle-foreground focus:border-subtle-foreground print:hidden"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border py-0.5 pr-2 pl-1.5 text-[11px] font-medium text-subtle-foreground transition-colors duration-100 hover:border-subtle-foreground hover:text-foreground motion-reduce:transition-none print:hidden"
        >
          <Plus className="size-3" aria-hidden="true" />
          tag
        </button>
      )}
    </div>
  );
}

/**
 * O painel de uma tag: o nome e a cor.
 *
 * **A cor grava na hora; o nome espera o Enter** — mesmo contrato do painel
 * da lousa: uma amostra de cor é um gesto só e o resultado se vê
 * imediatamente; o nome é digitado letra a letra, e gravar a cada tecla
 * criaria uma dúzia de renomeios auditados para uma correção só.
 */
function TagEditPanel({
  tag,
  onClose,
  onUpdate,
}: {
  tag: EditableTag;
  onClose: () => void;
  onUpdate: (patch: { name?: string; color?: string | null }) => void;
}) {
  const [draft, setDraft] = useState(tag.name);
  const boxRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
    nameRef.current?.select();

    function handleOutside(event: PointerEvent) {
      if (!boxRef.current?.contains(event.target as Node)) onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }

    // Na fase de borbulhamento basta: ao contrário da lousa, nada aqui para a
    // propagação dos próprios gestos.
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  function commitName() {
    const name = draft.trim();
    if (name && name.toLowerCase() !== tag.name) onUpdate({ name });
  }

  return (
    <div
      ref={boxRef}
      className="absolute top-full left-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-background shadow-lg"
    >
      <div className="flex items-center px-2.5 pt-2 pb-1.5 transition-colors duration-150 has-[:focus-visible]:bg-secondary/60 motion-reduce:transition-none">
        <span aria-hidden="true" className="text-xs text-subtle-foreground">
          #
        </span>
        <input
          aria-label="Nome da tag"
          ref={nameRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitName();
              onClose();
            }
          }}
          onBlur={commitName}
          maxLength={40}
          data-focus-ring="container"
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-foreground outline-none placeholder:text-subtle-foreground"
        />
      </div>

      <div className="border-t border-border px-2.5 py-2">
        <div
          role="group"
          aria-label="Cor da tag"
          className="flex items-center gap-1"
        >
          {TAG_PALETTE.map((position) => (
            <button
              key={position}
              type="button"
              aria-label={`Cor ${position}`}
              aria-pressed={tag.color === position}
              onClick={() => onUpdate({ color: position })}
              className={cn(
                "size-5 rounded-full border transition-transform duration-150 pointer-coarse:size-7 motion-reduce:transition-none",
                TAG_DOT_CLASS[position],
                tag.color === position
                  ? "scale-110 border-foreground"
                  : "border-transparent hover:scale-110"
              )}
            />
          ))}
          {/* Tirar a cor é uma escolha, não a ausência de uma. */}
          <button
            type="button"
            aria-label="Sem cor"
            aria-pressed={!tag.color}
            onClick={() => onUpdate({ color: null })}
            className={cn(
              "grid size-5 place-items-center rounded-full border bg-secondary text-muted-foreground transition-transform duration-150 pointer-coarse:size-7 motion-reduce:transition-none",
              tag.color
                ? "border-transparent hover:scale-110"
                : "scale-110 border-foreground"
            )}
          >
            <X className="size-2.5" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-2 text-[10px] leading-snug text-subtle-foreground">
          O nome e a cor valem em todas as notas com esta tag.
        </p>
      </div>
    </div>
  );
}
