"use client";

import { ArrowLeft, Check, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { readApiFailure } from "@/lib/api-failure";
import {
  TAG_CHIP_CLASS,
  TAG_DOT_CLASS,
  TAG_PALETTE,
  tagTone,
} from "@/lib/tags/palette";
import type { TagWithUsage } from "@/lib/tags/queries";
import { cn } from "@/lib/utils";

export interface TagPatch {
  name?: string;
  color?: string | null;
}

/**
 * O cabeçalho da tag aberta — e o lugar de cuidar dela.
 *
 * Até aqui a página só *mostrava* a tag: recolorir e apagar moravam no botão
 * direito de um nó do grafo, e renomear só existia no editor da nota. Quem
 * usa teclado, toque ou leitor de tela não tinha como arrumar nada aqui,
 * justamente na página que o dashboard anuncia como "o lugar para buscar,
 * editar e explorar tudo". As três ações agora ficam à vista, ao lado do
 * nome, e o botão direito do grafo continua como atalho.
 *
 * **A cor grava na hora; o nome espera o Enter** — o mesmo contrato do painel
 * de tag do editor e da lousa. A cor é otimista e volta atrás se o servidor
 * recusar; o nome só muda na tela depois da resposta, porque o servidor
 * normaliza (minúsculas, espaços) e pode recusar por já existir outra tag
 * com o mesmo nome.
 */
export function SelectedTagHeader({
  tag,
  startRenaming,
  onBack,
  onUpdated,
  onDelete,
}: {
  tag: TagWithUsage;
  /**
   * Pedido de fora (o menu do cartão) para já nascer com o campo de nome
   * aberto. Lido só na montagem — quem chama dá `key` pelo id da tag.
   */
  startRenaming: boolean;
  onBack: () => void;
  onUpdated: (tagId: string, patch: TagPatch) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(startRenaming);
  const [draft, setDraft] = useState(tag.name);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingColor, setSavingColor] = useState(false);
  const [colorError, setColorError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const nameErrorId = useId();
  const colorLabelId = useId();

  function openRename() {
    setDraft(tag.name);
    setNameError(null);
    setRenaming(true);
  }

  useEffect(() => {
    if (!renaming) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [renaming]);

  function closeRename() {
    setRenaming(false);
    setNameError(null);
    // O foco volta para quem abriu o campo, não para o topo da página.
    requestAnimationFrame(() => renameButtonRef.current?.focus());
  }

  async function saveName() {
    const name = draft.trim().replace(/\s+/g, " ");
    if (!name) {
      setNameError("Escreva o nome da tag.");
      return;
    }
    if (name.toLowerCase() === tag.name) {
      closeRename();
      return;
    }

    setSavingName(true);
    setNameError(null);
    try {
      const response = await fetch(`/api/tags/${tag.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const failure = await readApiFailure(
          response,
          "Não foi possível renomear a tag."
        );
        setNameError(failure.message);
        return;
      }
      const body = (await response.json()) as { tag: { name: string } };
      onUpdated(tag.id, { name: body.tag.name });
      closeRename();
    } catch {
      setNameError("Sem conexão com o servidor. Tente de novo.");
    } finally {
      setSavingName(false);
    }
  }

  async function pickColor(color: string | null) {
    if (color === tag.color) return;
    const previous = tag.color;

    onUpdated(tag.id, { color });
    setSavingColor(true);
    setColorError(false);

    try {
      const response = await fetch(`/api/tags/${tag.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color }),
      });
      if (!response.ok) throw new Error("PATCH failed");
    } catch {
      // Nada fica mentindo na tela: a cor volta para a que o banco tem.
      onUpdated(tag.id, { color: previous });
      setColorError(true);
    } finally {
      setSavingColor(false);
    }
  }

  const tone = tagTone(tag);

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 rounded-lg py-1 pr-2 text-sm text-subtle-foreground transition-colors duration-150 hover:text-foreground pointer-coarse:py-2.5"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Todas as tags
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {renaming ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <label
              className={cn(
                "flex h-9 min-w-0 flex-1 items-center rounded-full pr-1 pl-3 ring-1 ring-border focus-within:ring-2 focus-within:ring-foreground sm:max-w-80",
                TAG_CHIP_CLASS[tone]
              )}
            >
              <span aria-hidden="true" className="text-sm font-medium">
                #
              </span>
              <input
                ref={inputRef}
                aria-label="Novo nome da tag"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? nameErrorId : undefined}
                value={draft}
                maxLength={40}
                disabled={savingName}
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (nameError) setNameError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeRename();
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none disabled:opacity-70"
              />
            </label>
            <button
              type="submit"
              disabled={savingName}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-90 disabled:opacity-60 pointer-coarse:h-11"
            >
              <Check className="size-4" aria-hidden="true" />
              {savingName ? "Salvando…" : "Salvar"}
            </button>
            <button
              type="button"
              onClick={closeRename}
              disabled={savingName}
              className="h-9 shrink-0 rounded-full px-3 text-sm text-subtle-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground pointer-coarse:h-11"
            >
              Cancelar
            </button>
          </form>
        ) : (
          <>
            <h2
              id="selected-tag-heading"
              className={cn(
                "min-w-0 truncate rounded-full px-3 py-1 text-sm font-medium",
                TAG_CHIP_CLASS[tone]
              )}
            >
              #{tag.name}
            </h2>
            <span className="text-xs tabular-nums text-subtle-foreground">
              {tag.noteCount} {tag.noteCount === 1 ? "nota" : "notas"}
            </span>

            {/* Numa tela estreita as ações descem para a linha de baixo,
                alinhadas à esquerda com o resto da coluna (o -ml compensa o
                respiro interno do botão); a partir do sm voltam para a
                direita do nome. */}
            <div className="-ml-2.5 flex basis-full items-center gap-1 sm:ml-auto sm:basis-auto">
              <button
                ref={renameButtonRef}
                type="button"
                onClick={openRename}
                className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-subtle-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground pointer-coarse:h-11"
              >
                <Pencil className="size-3.5" aria-hidden="true" />
                Renomear
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-subtle-foreground transition-colors duration-150 hover:bg-error/10 hover:text-error pointer-coarse:h-11"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Apagar
              </button>
            </div>
          </>
        )}
      </div>

      {renaming && nameError && (
        <p id={nameErrorId} role="alert" className="mt-2 text-xs text-error">
          {nameError}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span id={colorLabelId} className="text-xs text-subtle-foreground">
          Cor
        </span>
        <div
          role="group"
          aria-labelledby={colorLabelId}
          className="flex items-center gap-1.5"
        >
          {TAG_PALETTE.map((position) => (
            <button
              key={position}
              type="button"
              disabled={savingColor}
              onClick={() => void pickColor(position)}
              aria-label={`Cor ${position}`}
              aria-pressed={tag.color === position}
              className={cn(
                "size-6 rounded-full border-2 transition-transform duration-150 motion-reduce:transition-none pointer-coarse:size-9",
                "disabled:cursor-not-allowed",
                TAG_DOT_CLASS[position],
                tag.color === position
                  ? "border-foreground"
                  : "border-transparent hover:scale-110"
              )}
            />
          ))}
          {/* Tirar a cor é uma escolha, não a ausência de uma: sem ela a tag
              volta a derivar a cor do próprio nome. */}
          <button
            type="button"
            disabled={savingColor}
            onClick={() => void pickColor(null)}
            aria-label="Cor automática, derivada do nome"
            aria-pressed={tag.color === null}
            title="Automática (deriva do nome)"
            className={cn(
              "grid size-6 place-items-center rounded-full border-2 bg-secondary text-muted-foreground transition-transform duration-150 motion-reduce:transition-none pointer-coarse:size-9",
              "disabled:cursor-not-allowed",
              tag.color === null
                ? "border-foreground"
                : "border-transparent hover:scale-110"
            )}
          >
            <RotateCcw className="size-3" aria-hidden="true" />
          </button>
        </div>
        <span role="status" className="text-xs">
          {savingColor ? (
            <span className="text-subtle-foreground">Salvando…</span>
          ) : colorError ? (
            <span className="text-error">
              Não foi possível salvar a cor. Tente de novo.
            </span>
          ) : null}
        </span>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-subtle-foreground">
        O nome e a cor valem em todas as notas com esta tag.
      </p>
    </div>
  );
}
