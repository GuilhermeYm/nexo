"use client";

import { LoaderCircle, Tags } from "lucide-react";

import type { NoteDeletionImpact } from "@/lib/notes/deletion-impact";
import { TAG_CHIP_CLASS, tagTone } from "@/lib/tags/palette";
import { cn } from "@/lib/utils";

/**
 * A escolha de apagar também as tags das notas que vão embora.
 *
 * Tag é global: ela não pertence à nota, aparece em todas as outras que a
 * usam. Por isso a caixa nunca aparece sozinha — vem com o impacto medido no
 * servidor, tag por tag, dizendo em quantas outras notas cada uma ainda é
 * usada. Marcar sem ver isso seria apagar de outras notas sem saber.
 *
 * Mora aqui, e não dentro de uma tela, porque as três portas de exclusão
 * fazem a mesma pergunta: a seleção em Notas, o menu de uma nota, e apagar
 * uma pasta com as notas de dentro. O que muda entre elas é só como se chama
 * o alvo — daí o `subject`, que entra nas frases em vez de obrigar cada tela
 * a repetir o bloco inteiro com outro texto.
 */
export function DeleteTagsChoice({
  impact,
  status,
  checked,
  disabled,
  onCheckedChange,
  onRetry,
  subject = {
    these: "destas notas",
    outside: "da seleção",
    empty: "Estas notas não têm tags para apagar.",
  },
}: {
  impact: NoteDeletionImpact | null;
  status: "idle" | "loading" | "error";
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
  onRetry: () => void;
  /** Como chamar o que está sendo apagado, nas três frases em que aparece. */
  subject?: {
    /** "Apagar também todas as tags ___" */
    these: string;
    /** "…aparecem em outras notas fora ___" */
    outside: string;
    /** A frase inteira de quando não há tag nenhuma. */
    empty: string;
    /** O selo da tag que não é usada em mais nenhuma nota. */
    only?: string;
  };
}) {
  const sharedTags = impact?.tags.filter((tag) => tag.otherNoteCount > 0) ?? [];

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border">
      <label
        className={cn(
          "flex items-start gap-3 px-3.5 py-3 text-sm text-foreground transition-colors",
          impact?.tags.length ? "cursor-pointer hover:bg-secondary/60" : "cursor-default"
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
          disabled={disabled || status !== "idle" || !impact?.tags.length}
          className="mt-0.5 size-4 accent-error"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-medium">
            <Tags className="size-4 text-muted-foreground" aria-hidden="true" />
            Apagar também todas as tags {subject.these}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {status === "loading"
              ? "Verificando onde essas tags também são usadas…"
              : impact?.tags.length
                ? `${impact.tags.length} ${impact.tags.length === 1 ? "tag será apagada" : "tags serão apagadas"} da sua conta.`
                : subject.empty}
          </span>
        </span>
        {status === "loading" && (
          <LoaderCircle
            className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
      </label>

      {status === "error" && (
        <div className="border-t border-border bg-error/10 px-3.5 py-3 text-xs text-error" role="alert">
          Não foi possível verificar o impacto nas tags.{" "}
          <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
            Tentar novamente
          </button>
        </div>
      )}

      {impact && impact.tags.length > 0 && (
        <div className="border-t border-border bg-secondary/45 px-3.5 py-3">
          {sharedTags.length > 0 ? (
            <p className="text-xs leading-relaxed text-error">
              Atenção: {sharedTags.length}{" "}
              {sharedTags.length === 1 ? "tag aparece" : "tags aparecem"} em outras notas
              fora {subject.outside}. Ao apagar as tags, essas notas também ficarão sem
              elas.
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Nenhuma dessas tags é usada em outra nota.
            </p>
          )}

          <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1" aria-label="Impacto da exclusão das tags">
            {impact.tags.map((tag) => (
              <li key={tag.id} className="rounded-lg bg-background px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={cn(
                      "inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                      TAG_CHIP_CLASS[tagTone(tag)]
                    )}
                  >
                    <span className="truncate">{tag.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {tag.otherNoteCount === 0
                      ? (subject.only ?? "Só na seleção")
                      : `Em mais ${tag.otherNoteCount}`}
                  </span>
                </div>
                {tag.otherNotes.length > 0 && (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    Também em: {tag.otherNotes.map((note) => note.title).join(", ")}
                    {tag.otherNoteCount > tag.otherNotes.length
                      ? ` e mais ${tag.otherNoteCount - tag.otherNotes.length}`
                      : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
