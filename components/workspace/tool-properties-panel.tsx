"use client";

import { Type, X } from "lucide-react";

import {
  TEXT_TONE_CLASS,
  TONES,
  TONE_SURFACE,
} from "@/components/workspace/window-bodies";
import type { WindowPatch } from "@/hooks/use-board-windows";
import type { BoardWindow, WindowContent } from "@/lib/workspace/queries";
import { cn } from "@/lib/utils";

interface ToolPropertiesPanelProps {
  window: BoardWindow;
  onChange: (patch: WindowPatch) => void;
  onClose: () => void;
}

/** Inspetor contextual da ferramenta usada pela janela selecionada. */
export function ToolPropertiesPanel({
  window,
  onChange,
  onClose,
}: ToolPropertiesPanelProps) {
  const backgroundTone = window.content?.backgroundTone ?? "none";
  const textTone = window.content?.textTone ?? "default";

  return (
    <aside
      aria-label="Propriedades da caixa de texto"
      className="absolute inset-y-0 right-0 z-20 flex w-[min(17rem,calc(100%-1rem))] flex-col bg-background shadow-[-12px_0_36px_-20px] shadow-black/30"
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Type className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">
            Caixa de texto
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Aparência da caixa selecionada
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Fechar propriedades"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:size-11"
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Fechar propriedades</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <ColorSection
          title="Fundo"
          description="Use uma superfície da paleta ou deixe a caixa leve sobre a lousa."
          value={backgroundTone}
          options={["none", ...TONES]}
          labelOf={(value) =>
            value === "none" ? "Sem cor de fundo" : `Cor de fundo ${value}`
          }
          renderSwatch={(value) =>
            value === "none" ? (
              <X className="size-3.5" aria-hidden="true" />
            ) : (
              <span
                aria-hidden="true"
                className={cn("size-full rounded-lg border", TONE_SURFACE[value])}
              />
            )
          }
          onChange={(value) =>
            onChange({
              backgroundTone: value as WindowContent["backgroundTone"],
            })
          }
        />

        <ColorSection
          title="Texto"
          description="A cor acompanha os temas claro e escuro automaticamente."
          value={textTone}
          options={["default", ...TONES]}
          labelOf={(value) =>
            value === "default" ? "Cor de texto padrão" : `Cor de texto ${value}`
          }
          renderSwatch={(value) => (
            <span
              aria-hidden="true"
              className={cn(
                "text-sm font-bold",
                TEXT_TONE_CLASS[value] ?? TEXT_TONE_CLASS.default
              )}
            >
              A
            </span>
          )}
          onChange={(value) =>
            onChange({ textTone: value as WindowContent["textTone"] })
          }
        />

        <div className="mt-6 rounded-xl bg-secondary px-3.5 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            As escolhas valem só para esta caixa e são sincronizadas com a sua
            conta.
          </p>
        </div>
      </div>
    </aside>
  );
}

/** Uma fileira de amostras. Compartilhada com o inspetor da ligação. */
export function ColorSection({
  title,
  description,
  value,
  options,
  labelOf,
  renderSwatch,
  onChange,
}: {
  title: string;
  description: string;
  value: string;
  options: string[];
  labelOf: (value: string) => string;
  renderSwatch: (value: string) => React.ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <section className="not-first:mt-7">
      <h3 className="text-xs font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
      <div
        role="group"
        aria-label={title}
        className="mt-3 grid grid-cols-7 gap-1.5 pointer-coarse:grid-cols-4"
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={labelOf(option)}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "flex aspect-square items-center justify-center rounded-lg p-1 text-subtle-foreground transition-[transform,box-shadow] duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none",
              value === option
                ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                : "bg-secondary"
            )}
          >
            {renderSwatch(option)}
          </button>
        ))}
      </div>
    </section>
  );
}
