"use client";

import { Spline, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ColorSection } from "@/components/workspace/tool-properties-panel";
import type { ConnectionPatch } from "@/hooks/use-board-windows";
import {
  CONNECTION_HEADS,
  CONNECTION_STROKES,
  CONNECTION_TONES,
  CONNECTION_TONE_CLASS,
  CONNECTION_WEIGHTS,
  WEIGHT_PX,
  dashArrayOf,
  type ConnectionHeads,
  type ConnectionStroke,
  type ConnectionTone,
  type ConnectionWeight,
} from "@/lib/workspace/connection-style";
import type { BoardConnection } from "@/lib/workspace/queries";
import { cn } from "@/lib/utils";

/**
 * O inspetor da ligação selecionada.
 *
 * O mesmo lugar e a mesma forma do inspetor da caixa de texto
 * (`ToolPropertiesPanel`): à direita da lousa, some ao clicar no fundo, com
 * `Esc` ou ao pegar uma ferramenta. Tudo aqui grava na hora — uma amostra é
 * um gesto só, e o resultado aparece na flecha enquanto a pessoa olha.
 *
 * O texto é a exceção parcial: ele entra na flecha enquanto se digita, mas
 * a gravação espera uma pausa (`LABEL_DELAY`), para uma palavra não virar
 * uma requisição por letra.
 */

const LABEL_DELAY = 500;

interface ConnectionPropertiesPanelProps {
  connection: BoardConnection;
  fromTitle: string;
  toTitle: string;
  onChange: (patch: ConnectionPatch) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function ConnectionPropertiesPanel({
  connection,
  fromTitle,
  toTitle,
  onChange,
  onRemove,
  onClose,
}: ConnectionPropertiesPanelProps) {
  return (
    <aside
      aria-label="Propriedades da ligação"
      data-connection-panel={connection.id}
      className="absolute inset-y-0 right-0 z-20 flex w-[min(17rem,calc(100%-1rem))] flex-col bg-background shadow-[-12px_0_36px_-20px] shadow-black/30"
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Spline className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Ligação</h2>
          <p
            className="mt-0.5 truncate text-xs leading-relaxed text-muted-foreground"
            title={`${fromTitle} → ${toTitle}`}
          >
            {fromTitle} → {toTitle}
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
        {/* A chave remonta o campo ao trocar de flecha: o rascunho de uma
            não pode vazar para a outra. */}
        <LabelSection
          key={connection.id}
          initial={connection.label ?? ""}
          onCommit={(label) => onChange({ label })}
        />

        <ColorSection
          title="Cor"
          description="Vale para o traço e para o texto, nos dois temas."
          value={connection.tone ?? "none"}
          options={["none", ...CONNECTION_TONES]}
          labelOf={(value) =>
            value === "none" ? "Cor neutra" : `Cor ${value}`
          }
          renderSwatch={(value) => (
            <span
              aria-hidden="true"
              className={cn(
                "h-1 w-4 rounded-full bg-current",
                value === "none"
                  ? "text-subtle-foreground"
                  : CONNECTION_TONE_CLASS[value as ConnectionTone]
              )}
            />
          )}
          onChange={(value) =>
            onChange({
              tone: value === "none" ? null : (value as ConnectionTone),
            })
          }
        />

        <OptionSection<ConnectionStroke>
          title="Traço"
          value={connection.stroke}
          options={CONNECTION_STROKES}
          labelOf={(value) =>
            ({ solid: "Contínuo", dashed: "Tracejado", dotted: "Pontilhado" })[
              value
            ]
          }
          renderPreview={(value) => (
            <LinePreview stroke={value} weight="regular" heads="none" />
          )}
          onChange={(stroke) => onChange({ stroke })}
        />

        <OptionSection<ConnectionWeight>
          title="Espessura"
          value={connection.weight}
          options={CONNECTION_WEIGHTS}
          labelOf={(value) =>
            ({ thin: "Fina", regular: "Média", bold: "Grossa" })[value]
          }
          renderPreview={(value) => (
            <LinePreview stroke="solid" weight={value} heads="none" />
          )}
          onChange={(weight) => onChange({ weight })}
        />

        <OptionSection<ConnectionHeads>
          title="Pontas"
          value={connection.heads}
          options={CONNECTION_HEADS}
          labelOf={(value) =>
            ({ none: "Sem ponta", end: "No destino", both: "Nos dois lados" })[
              value
            ]
          }
          renderPreview={(value) => (
            <LinePreview stroke="solid" weight="regular" heads={value} />
          )}
          onChange={(heads) => onChange({ heads })}
        />

        <button
          type="button"
          onClick={onRemove}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:py-3"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Remover a ligação
        </button>
        <p className="mt-2 text-center text-[11px] leading-relaxed text-subtle-foreground">
          Os dois elementos continuam onde estão.
        </p>
      </div>
    </aside>
  );
}

/**
 * O texto da flecha.
 *
 * Grava numa pausa da digitação e, sem esperar, ao sair do campo ou no Enter
 * — sair do inspetor com texto na fila não pode perdê-lo.
 */
function LabelSection({
  initial,
  onCommit,
}: {
  initial: string;
  onCommit: (label: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const commit = useRef(onCommit);

  useEffect(() => {
    commit.current = onCommit;
  }, [onCommit]);

  function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current === null) return;
    commit.current(pending.current);
    pending.current = null;
  }

  // Fechar o inspetor (ou trocar de flecha) descarrega o que ficou na fila.
  useEffect(() => flush, []);

  return (
    <section>
      <label
        htmlFor="connection-label"
        className="text-xs font-semibold text-foreground"
      >
        Texto
      </label>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Aparece dentro da flecha. Uma palavra sobre o que liga as duas.
      </p>
      <input
        id="connection-label"
        value={value}
        maxLength={80}
        placeholder="ex.: causa, exemplo de"
        onChange={(event) => {
          setValue(event.target.value);
          pending.current = event.target.value;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, LABEL_DELAY);
        }}
        onBlur={flush}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            flush();
          }
        }}
        className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors duration-150 placeholder:text-subtle-foreground focus:border-subtle-foreground focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:py-3"
      />
    </section>
  );
}

function OptionSection<T extends string>({
  title,
  value,
  options,
  labelOf,
  renderPreview,
  onChange,
}: {
  title: string;
  value: T;
  options: readonly T[];
  labelOf: (value: T) => string;
  renderPreview: (value: T) => React.ReactNode;
  onChange: (value: T) => void;
}) {
  return (
    <section className="mt-7">
      <h3 className="text-xs font-semibold text-foreground">{title}</h3>
      <div
        role="group"
        aria-label={title}
        className="mt-3 grid grid-cols-3 gap-1.5"
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg px-1 pt-2.5 pb-2 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none pointer-coarse:py-3",
              value === option
                ? "bg-foreground text-background"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            {renderPreview(option)}
            {labelOf(option)}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Uma flecha em miniatura, desenhada com as mesmas regras da lousa. */
function LinePreview({
  stroke,
  weight,
  heads,
}: {
  stroke: ConnectionStroke;
  weight: ConnectionWeight;
  heads: ConnectionHeads;
}) {
  const width = WEIGHT_PX[weight];
  return (
    <svg
      viewBox="0 0 40 12"
      className="h-3 w-10"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M 4 6 L 36 6"
        strokeWidth={width}
        strokeDasharray={dashArrayOf(stroke, width)}
      />
      {heads !== "none" && (
        <path d="M 31 2 L 36 6 L 31 10" strokeWidth={width} />
      )}
      {heads === "both" && <path d="M 9 2 L 4 6 L 9 10" strokeWidth={width} />}
    </svg>
  );
}
