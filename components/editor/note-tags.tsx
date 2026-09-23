"use client";

import { LoaderCircle, Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { TagMenuContent, useTagDeletion } from "@/components/tags/tag-menu";
import {
  TAG_DOT_CLASS,
  TAG_PALETTE,
  type TagPalette,
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
 * `id` que só o servidor conhece, então ele entra quando a resposta chega —
 * e enquanto isso um chip-fantasma com spinner ocupa o lugar dele (estado de
 * espera). Quando a resposta chega, o chip real nasce com a animação de
 * entrada (`animate-tag-in`); se o POST falhar, o texto volta ao campo.
 *
 * **Botão direito no chip abre o menu da tag** (`TagMenuContent`): editar ou
 * apagar. Apagar é da **conta**, não só desta nota — o fluxo mede o impacto
 * e só mostra o aviso quando outras notas usam a mesma tag.
 *
 * **Impressão.** Os controles de edição ("Adicionar", o "×") levam
 * `print:hidden` — são chrome da tela, não conteúdo da nota.
 */

export interface EditableTag {
  id: string;
  name: string;
  color: string | null;
}

/** Quantas sugestões aparecem de uma vez: o bastante para escolher, pouco
 *  para não virar lista de rolar. */
const MAX_SUGGESTIONS = 6;

function dotClass(tag: { color: string | null }): string {
  return (TAG_PALETTE as readonly string[]).includes(tag.color ?? "")
    ? TAG_DOT_CLASS[tag.color as TagPalette]
    : "bg-subtle-foreground/50";
}

function normalize(name: string): string {
  // A mesma normalização da rota (`addTagSchema`): o "Criar" só aparece
  // quando o nome é de fato novo.
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function NoteTags({
  noteId,
  initialTags,
  vocabulary,
  onCountChange,
  onTagsChange,
}: {
  noteId: string;
  initialTags: EditableTag[];
  /** Quantas tags a nota tem agora — o resumo da ficha recolhida mostra. */
  onCountChange?: (count: number) => void;
  /** A lista final depois de cada mudança, inclusive reversão de erro. */
  onTagsChange?: (tags: EditableTag[]) => void;
  /** As tags que a pessoa já tem, das mais usadas às menos — as sugestões. */
  vocabulary: EditableTag[];
}) {
  const [tags, setTags] = useState(initialTags);
  const tagsRef = useRef(initialTags);
  const [known, setKnown] = useState(vocabulary);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  // Quem já estava aqui na abertura não anima: a animação é de chegada, e
  // disparar em todo re-render fariam os chips piscarem a cada tecla.
  const [entryIds] = useState(() => new Set(initialTags.map((tag) => tag.id)));

  // O chip-fantasma enquanto o POST de adicionar não responde.
  const [pendingName, setPendingName] = useState<string | null>(null);
  const pendingRef = useRef(false);

  // O menu de contexto é um portal: dentro de um `<dialog>` (top layer) ele
  // precisa nascer dentro do próprio diálogo, senão fica atrás dele e some.
  const rootRef = useRef<HTMLElement>(null);
  const [menuContainer, setMenuContainer] = useState<HTMLElement | undefined>(
    undefined
  );

  useEffect(() => {
    setMenuContainer(rootRef.current?.closest("dialog") ?? undefined);
  }, []);

  const changeTags = useCallback(
    (update: (current: EditableTag[]) => EditableTag[]) => {
      const next = update(tagsRef.current);
      if (next === tagsRef.current) return;
      tagsRef.current = next;
      setTags(next);
      onTagsChange?.(next);
    },
    [onTagsChange]
  );

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  useEffect(() => {
    onCountChange?.(tags.length);
  }, [tags.length, onCountChange]);

  const add = useCallback(
    async (name: string) => {
      // Uma espera de cada vez: dois POSTs simultâneos trocariam o
      // chip-fantasma no meio do voo, e o segundo terminaria sem sinal na
      // tela. O fantasma visível já diz que está em curso.
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPendingName(name);
      try {
        const response = await fetch(`/api/notes/${noteId}/tags`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!response.ok) {
          // O texto volta ao campo: uma falha silenciosa que também engole o
          // que a pessoa digitou apagaria o trabalho dela sem avisar.
          setValue(name);
          return;
        }
        const body = (await response.json()) as { tag: EditableTag };
        // A rota é idempotente (`onConflictDoNothing`): marcar de novo uma
        // tag que a nota já tem não duplica o chip.
        changeTags((current) =>
          current.some((tag) => tag.id === body.tag.id)
            ? current
            : [...current, body.tag]
        );
        setKnown((current) =>
          current.some((tag) => tag.id === body.tag.id)
            ? current
            : [body.tag, ...current]
        );
      } catch {
        // A nota em si nunca é afetada; o texto volta para tentar de novo.
        setValue(name);
      } finally {
        pendingRef.current = false;
        setPendingName(null);
      }
    },
    [noteId, changeTags]
  );

  const remove = useCallback(
    async (tagId: string) => {
      // Otimista: o chip sai na hora e volta se a rota recusar.
      let previous: EditableTag[] = [];
      changeTags((current) => {
        previous = current;
        return current.filter((tag) => tag.id !== tagId);
      });
      try {
        const response = await fetch(
          `/api/notes/${noteId}/tags?tagId=${tagId}`,
          { method: "DELETE" }
        );
        if (!response.ok) changeTags(() => previous);
      } catch {
        changeTags(() => previous);
      }
    },
    [noteId, changeTags]
  );

  const update = useCallback(
    async (tagId: string, patch: { name?: string; color?: string | null }) => {
      // Otimista pelo mesmo motivo: uma amostra de cor é um gesto só, e o
      // resultado tem que se ver imediatamente.
      let previous: EditableTag[] = [];
      changeTags((current) => {
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
          changeTags(() => previous);
          return;
        }
        const body = (await response.json()) as { tag: EditableTag };
        changeTags((current) =>
          current.map((tag) => (tag.id === tagId ? body.tag : tag))
        );
        setKnown((current) =>
          current.map((tag) => (tag.id === tagId ? body.tag : tag))
        );
      } catch {
        changeTags(() => previous);
      }
    },
    [changeTags]
  );

  const closePanel = useCallback(() => setEditingId(null), []);

  // Apagar a tag é da conta: ela sai da lista aqui, do vocabulário de
  // sugestões, e o painel de edição fecha se era dela que estava aberto.
  const deletion = useTagDeletion({
    currentNoteId: noteId,
    onDeleted: (tagId) => {
      changeTags((current) => current.filter((tag) => tag.id !== tagId));
      setKnown((current) => current.filter((tag) => tag.id !== tagId));
      setEditingId((current) => (current === tagId ? null : current));
    },
  });

  // As sugestões: tags que a pessoa já usa e esta nota ainda não tem. Quem
  // começa pelo nome vem antes de quem só o contém.
  const query = normalize(value);
  const onNote = new Set(tags.map((tag) => tag.id));
  const available = known.filter((tag) => !onNote.has(tag.id));
  const matches = query
    ? [
        ...available.filter((tag) => tag.name.startsWith(query)),
        ...available.filter(
          (tag) => !tag.name.startsWith(query) && tag.name.includes(query)
        ),
      ]
    : available;
  const suggestions = matches.slice(0, MAX_SUGGESTIONS);
  const exists =
    known.some((tag) => tag.name === query) ||
    tags.some((tag) => tag.name === query);
  // A última opção é criar — só quando o nome digitado ainda não existe.
  const options: { key: string; name: string; tag: EditableTag | null }[] = [
    ...suggestions.map((tag) => ({ key: tag.id, name: tag.name, tag })),
    ...(query && !exists ? [{ key: "__create", name: query, tag: null }] : []),
  ];
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  function close(returnFocus: boolean) {
    setValue("");
    setActive(0);
    setAdding(false);
    if (returnFocus) requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  function choose(name: string) {
    void add(name);
    setValue("");
    setActive(0);
    inputRef.current?.focus();
  }

  const editing = tags.find((tag) => tag.id === editingId) ?? null;

  // A linha é um par `dt`/`dd` da ficha da nota, e mora aqui porque só aqui
  // se sabe se há tag: sem nenhuma, o PDF não imprime um rótulo vazio.
  return (
    <>
      <dt
        className={cn(
          "flex h-7 items-center text-xs text-subtle-foreground pointer-coarse:h-9",
          tags.length === 0 && "print:hidden"
        )}
      >
        Tags
      </dt>
      <dd ref={rootRef} className={cn("min-w-0", tags.length === 0 && "print:hidden")}>
        <div className="relative flex min-h-7 flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <ContextMenu
              key={tag.id}
              onOpenChange={(open) => {
                if (open) deletion.prime(tag);
              }}
            >
              <ContextMenuTrigger asChild>
                <span
                  className={cn(
                    "group/tag inline-flex h-7 max-w-56 items-center rounded-md border border-border bg-background text-xs text-foreground transition-colors duration-150 hover:border-subtle-foreground/60 motion-reduce:transition-none pointer-coarse:h-9",
                    editingId === tag.id && "border-subtle-foreground",
                    // Chip que acaba de chegar (a animação é de chegada) —
                    // quem já estava aqui desde a abertura não pisca.
                    !entryIds.has(tag.id) &&
                      "animate-tag-in motion-reduce:animate-none"
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setEditingId((current) =>
                        current === tag.id ? null : tag.id
                      )
                    }
                    aria-label={`Editar a tag ${tag.name}`}
                    aria-expanded={editingId === tag.id}
                    className="flex h-full min-w-0 items-center gap-1.5 rounded-md pr-0.5 pl-2 print:pr-2"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-2 shrink-0 rounded-full print:hidden",
                        dotClass(tag)
                      )}
                    />
                    <span className="truncate">{tag.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(tag.id)}
                    aria-label={`Tirar a tag ${tag.name}`}
                    // Sempre à vista, mas apagado: um "×" que só nasce no hover
                    // deixaria um vão vazio no chip o resto do tempo.
                    className="mr-0.5 grid size-5 shrink-0 place-items-center rounded text-subtle-foreground/70 transition-colors duration-100 hover:bg-tertiary hover:text-foreground motion-reduce:transition-none pointer-coarse:size-8 print:hidden"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              </ContextMenuTrigger>

              <TagMenuContent
                tag={tag}
                container={menuContainer}
                onEdit={() =>
                  setEditingId((current) =>
                    current === tag.id ? null : tag.id
                  )
                }
                onDelete={() => deletion.request(tag)}
              />
            </ContextMenu>
          ))}

          {/* O chip-fantasma: a espera do POST não-otimista, com o nome que
              está voando. Ele ocupa o lugar do chip real para a linha não
              engolir o gesto — sumir sem sinal depois de um clique seria
              indistinguível de ter dado errado. */}
          {pendingName !== null && (
            <span
              aria-busy="true"
              className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border border-dashed border-subtle-foreground/60 px-2 text-xs text-subtle-foreground pointer-coarse:h-9 print:hidden"
            >
              <LoaderCircle
                className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              <span className="truncate">{pendingName}</span>
              <span className="sr-only">Adicionando a tag…</span>
            </span>
          )}

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
            <div className="relative print:hidden">
              <input
                ref={inputRef}
                role="combobox"
                aria-label="Adicionar tag"
                aria-expanded={options.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={
                  options.length > 0 ? `${listId}-${activeIndex}` : undefined
                }
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && options.length > 0) {
                    event.preventDefault();
                    setActive((activeIndex + 1) % options.length);
                  }
                  if (event.key === "ArrowUp" && options.length > 0) {
                    event.preventDefault();
                    setActive(
                      (activeIndex - 1 + options.length) % options.length
                    );
                  }
                  if (event.key === "Enter" || event.key === ",") {
                    event.preventDefault();
                    const option = options[activeIndex];
                    if (option) choose(option.name);
                    else if (!query) close(true);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    close(true);
                  }
                }}
                // O clique numa sugestão acontece antes do blur (ver `onMouseDown`
                // da lista), então fechar aqui não engole a escolha.
                onBlur={() => close(false)}
                placeholder="Buscar ou criar tag"
                maxLength={40}
                data-focus-ring="container"
                className="h-7 w-44 rounded-md border border-subtle-foreground bg-background px-2 text-xs text-foreground outline-none placeholder:text-subtle-foreground pointer-coarse:h-9"
              />

              {options.length > 0 && (
                <ul
                  id={listId}
                  role="listbox"
                  aria-label="Tags"
                  // Sem isto o `mousedown` tira o foco do campo antes do clique,
                  // o blur fecha a lista e a escolha se perde.
                  onMouseDown={(event) => event.preventDefault()}
                  className="absolute top-full left-0 z-30 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.18)]"
                >
                  {options.map((option, index) => (
                    <li
                      key={option.key}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === activeIndex}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(option.name)}
                      className={cn(
                        "mx-1 flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-foreground pointer-coarse:h-11",
                        index === activeIndex && "bg-tertiary"
                      )}
                    >
                      {option.tag ? (
                        <>
                          <span
                            aria-hidden="true"
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              dotClass(option.tag)
                            )}
                          />
                          <span className="truncate">{option.name}</span>
                        </>
                      ) : (
                        <>
                          <Plus
                            className="size-3.5 shrink-0 text-subtle-foreground"
                            aria-hidden="true"
                          />
                          <span className="truncate">
                            Criar{" "}
                            <span className="font-medium">{option.name}</span>
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <button
              ref={addButtonRef}
              type="button"
              onClick={() => setAdding(true)}
              aria-label="Adicionar tag"
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground motion-reduce:transition-none pointer-coarse:h-9 print:hidden",
                tags.length === 0 && "pr-2"
              )}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              {tags.length === 0 && "Adicionar"}
            </button>
          )}
        </div>
      </dd>

      {deletion.dialog}
    </>
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
      className="absolute top-full left-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-background shadow-[0_8px_24px_-8px_rgb(0_0_0/0.18)]"
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
