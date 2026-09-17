"use client";

import { FileText, Paperclip, StickyNote, Type, X } from "lucide-react";

import {
  TEXT_TONE_CLASS,
  TONES,
  TONE_SURFACE,
} from "@/components/workspace/window-bodies";
import type { WindowPatch } from "@/hooks/use-board-windows";
import {
  BOARD_PATTERNS,
  BOARD_PATTERN_LABEL,
  boardBackgroundStyle,
  boardSurfaceClass,
  type BoardBackground,
  type BoardPattern,
  type BoardTone,
} from "@/lib/workspace/board-background";
import type { BoardWindow, WindowContent } from "@/lib/workspace/queries";
import { cn } from "@/lib/utils";

/**
 * O inspetor da ferramenta selecionada.
 *
 * Ele abre para **qualquer** elemento da lousa, e não só para a caixa de
 * texto como na primeira etapa. O motivo é o fundo: mudar a cara da lousa é
 * uma propriedade da lousa, não do elemento, mas o gesto que leva até ela é
 * sempre o mesmo — selecionar alguma coisa e olhar para a direita. Ter esse
 * painel aparecendo só na caixa de texto faria a pessoa precisar criar uma
 * caixa de texto para poder trocar o fundo.
 *
 * Daí a divisão que o painel desenha em voz alta: em cima, o que vale **só
 * para aquele elemento** (e alguns tipos não têm nada aqui, o que é dito em
 * uma linha em vez de silêncio); embaixo, separado, o que vale **para a lousa
 * inteira**.
 */

interface ToolPropertiesPanelProps {
  window: BoardWindow;
  background: BoardBackground;
  onChange: (patch: WindowPatch) => void;
  onBackgroundChange: (patch: Partial<BoardBackground>) => void;
  onClose: () => void;
}

const KIND_META: Record<
  BoardWindow["kind"],
  { title: string; icon: typeof Type; blurb: string }
> = {
  text: {
    title: "Caixa de texto",
    icon: Type,
    blurb: "Aparência da caixa selecionada",
  },
  sticky: { title: "Post-it", icon: StickyNote, blurb: "Cor do post-it" },
  note: { title: "Nota", icon: FileText, blurb: "Elemento selecionado" },
  attachment: {
    title: "Arquivo",
    icon: Paperclip,
    blurb: "Elemento selecionado",
  },
};

export function ToolPropertiesPanel({
  window,
  background,
  onChange,
  onBackgroundChange,
  onClose,
}: ToolPropertiesPanelProps) {
  const backgroundTone = window.content?.backgroundTone ?? "none";
  const textTone = window.content?.textTone ?? "default";
  const borderless = window.content?.borderless === true;
  const stickyTone = window.content?.tone ?? "1";

  const meta = KIND_META[window.kind];
  const Icon = meta.icon;
  // Nota e anexo ainda não têm aparência própria: o conteúdo deles é a nota e
  // o arquivo, e a moldura é a mesma para todos.
  const hasOwnProperties = window.kind === "text" || window.kind === "sticky";

  return (
    <aside
      aria-label={`Propriedades — ${meta.title}`}
      className="absolute inset-y-0 right-0 z-20 flex w-[min(17rem,calc(100%-1rem))] flex-col bg-background shadow-[-12px_0_36px_-20px] shadow-black/30"
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">
            {meta.title}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {meta.blurb}
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
        {window.kind === "text" && (
          <>
            <section>
              <h3 className="text-xs font-semibold text-foreground">Moldura</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Sem moldura fica só o texto sobre a lousa. Ao editar, a borda
                volta por um instante, para deixar claro qual caixa está sendo
                mexida.
              </p>
              <div
                role="group"
                aria-label="Moldura"
                className="mt-3 grid grid-cols-2 gap-1.5"
              >
                {(
                  [
                    { value: false, label: "Com moldura" },
                    { value: true, label: "Sem moldura" },
                  ] as const
                ).map((option) => (
                  <button
                    key={String(option.value)}
                    type="button"
                    aria-pressed={borderless === option.value}
                    onClick={() => onChange({ borderless: option.value })}
                    className={cn(
                      "rounded-lg px-2 py-2.5 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none pointer-coarse:py-3",
                      borderless === option.value
                        ? "bg-foreground text-background"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            {!borderless && (
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
                      className={cn(
                        "size-full rounded-lg border",
                        TONE_SURFACE[value]
                      )}
                    />
                  )
                }
                onChange={(value) =>
                  onChange({
                    backgroundTone: value as WindowContent["backgroundTone"],
                  })
                }
              />
            )}

            <ColorSection
              title="Texto"
              description="A cor acompanha os temas claro e escuro automaticamente."
              value={textTone}
              options={["default", ...TONES]}
              labelOf={(value) =>
                value === "default"
                  ? "Cor de texto padrão"
                  : `Cor de texto ${value}`
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
          </>
        )}

        {window.kind === "sticky" && (
          <ColorSection
            title="Cor do post-it"
            description="A mesma escolha da fileira que aparece dentro do post-it."
            value={stickyTone}
            options={[...TONES]}
            labelOf={(value) => `Cor ${value}`}
            renderSwatch={(value) => (
              <span
                aria-hidden="true"
                className={cn("size-full rounded-lg border", TONE_SURFACE[value])}
              />
            )}
            onChange={(value) => onChange({ tone: value })}
          />
        )}

        {hasOwnProperties && (
          <div
            aria-hidden="true"
            className="mt-7 border-t border-dashed border-border"
          />
        )}

        <BoardBackgroundSection
          background={background}
          onChange={onBackgroundChange}
          standalone={!hasOwnProperties}
          kindTitle={meta.title}
        />

        <div className="mt-6 rounded-xl bg-secondary px-3.5 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {hasOwnProperties
              ? "As escolhas de cima valem só para este elemento; o fundo vale para a lousa inteira. Tudo é sincronizado com a sua conta."
              : "O fundo vale para a lousa inteira e é sincronizado com a sua conta."}
          </p>
        </div>
      </div>
    </aside>
  );
}

/**
 * O fundo da lousa.
 *
 * Duas escolhas separadas — a trama e a cor da superfície — porque quem quer
 * papel quadriculado e quem quer papel colorido está pedindo coisas
 * diferentes. Uma lista única com as vinte e oito combinações seria uma lista
 * que ninguém percorre até o fim.
 */
function BoardBackgroundSection({
  background,
  onChange,
  standalone,
  kindTitle,
}: {
  background: BoardBackground;
  onChange: (patch: Partial<BoardBackground>) => void;
  /** O elemento selecionado não tem aparência própria — vale dizer por quê. */
  standalone: boolean;
  kindTitle: string;
}) {
  return (
    <>
      <section className={standalone ? undefined : "mt-7"}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-accent/50">
          Configurações globais
        </p>
        <h3 className="mt-1 text-xs font-semibold text-foreground">
          Fundo da lousa
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {standalone
            ? `${kindTitle} não tem aparência própria — o que dá para ajustar daqui é a superfície por baixo dela.`
            : "Vale para a lousa inteira, não só para este elemento."}
        </p>
        <div
          role="group"
          aria-label="Trama do fundo"
          className="mt-3 grid grid-cols-2 gap-1.5"
        >
          {BOARD_PATTERNS.map((pattern) => (
            <button
              key={pattern}
              type="button"
              aria-pressed={background.pattern === pattern}
              onClick={() => onChange({ pattern })}
              className={cn(
                "flex items-center gap-2 rounded-lg p-1.5 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none",
                background.pattern === pattern
                  ? "bg-foreground text-background"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              <PatternPreview pattern={pattern} tone={background.tone} />
              {BOARD_PATTERN_LABEL[pattern]}
            </button>
          ))}
        </div>
      </section>

      <ColorSection
        title="Superfície"
        description="A cor do papel. Sem cor é a lousa neutra, que acompanha o tema."
        value={background.tone ?? "none"}
        options={["none", ...TONES]}
        labelOf={(value) =>
          value === "none" ? "Superfície neutra" : `Superfície ${value}`
        }
        renderSwatch={(value) =>
          value === "none" ? (
            <span
              aria-hidden="true"
              className="size-full rounded-lg border border-border bg-tertiary"
            />
          ) : (
            <span
              aria-hidden="true"
              className={cn("size-full rounded-lg border", TONE_SURFACE[value])}
            />
          )
        }
        onChange={(value) =>
          onChange({ tone: value === "none" ? null : (value as BoardTone) })
        }
      />
    </>
  );
}

/**
 * A amostra da trama.
 *
 * Desenhada pelo **mesmo** código que pinta a lousa, com um zoom fixo de
 * 0,5 — que é exatamente o espaçamento mínimo da trama. Uma imagem à parte
 * envelheceria no dia em que a trama mudasse.
 */
function PatternPreview({
  pattern,
  tone,
}: {
  pattern: BoardPattern;
  tone: BoardTone | null;
}) {
  return (
    <span
      aria-hidden="true"
      style={boardBackgroundStyle({ pattern, tone }, { x: 2, y: 2, zoom: 0.5 })}
      className={cn(
        "size-6 shrink-0 rounded-md border border-border",
        boardSurfaceClass(tone)
      )}
    />
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
