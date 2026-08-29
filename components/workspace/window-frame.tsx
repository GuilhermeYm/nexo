"use client";

import { Minus, Square, X } from "lucide-react";
import {
  useCallback,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";

import type { WindowPatch } from "@/hooks/use-board-windows";
import type { BoardWindow } from "@/lib/workspace/queries";
import { cn } from "@/lib/utils";

/**
 * O quadro de uma janela: barra de título, arraste, redimensionamento e os
 * três controles.
 *
 * **Ponteiros, não mouse.** Todos os gestos usam eventos de ponteiro com
 * `setPointerCapture`. Um código só atende mouse, dedo e caneta, e a captura
 * garante que o arraste continue mesmo quando o cursor sai da janela — sem
 * ela, mexer rápido "solta" a janela no meio do caminho.
 *
 * **Nada é persistido durante o gesto.** O movimento é estado local a 60fps;
 * quem grava é o `onCommit`, chamado uma vez quando a pessoa solta.
 *
 * **O teclado também move.** A alça de arraste é um botão de verdade: com
 * foco nela, as setas movem a janela (com Shift, de 1 em 1 pixel). Sem isso a
 * lousa seria uma superfície só para quem usa mouse.
 */

/**
 * Passo do grid. Arranjo feito à mão fica alinhado sem a pessoa mirar.
 *
 * Exportado porque a criação usa o mesmo passo: uma janela que nasce fora do
 * grid nunca mais se alinha com as vizinhas, já que o encaixe do arraste
 * preserva o resto da divisão.
 */
export const BOARD_GRID = 8;
const GRID = BOARD_GRID;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 120;
const KEYBOARD_STEP = 16;

/**
 * Além dos props próprios, a moldura repassa para o `<article>` tudo o que
 * receber de fora. É assim que o `ContextMenuTrigger` do Radix consegue
 * instalar os ouvintes dele — botão direito e toque longo — sem a janela
 * precisar saber que existe um menu.
 */
interface WindowFrameProps extends Omit<
  ComponentProps<"article">,
  "title" | "onFocus" | "children"
> {
  window: BoardWindow;
  /** Zoom atual da lousa — converte pixels de tela em pixels da lousa. */
  zoom: number;
  /** Nome real da janela — vai para os `aria-label`, sempre. */
  title: string;
  /** O que a barra mostra. Nem sempre é o título: ver `labelOf` no Board. */
  label: string;
  /** Ícone à esquerda do título. */
  icon?: ReactNode;
  focused: boolean;
  /** Classes de cor do quadro, para os post-its. */
  toneClass?: string;
  children: ReactNode;
  onFocus: () => void;
  /** Durante o gesto: só estado local. */
  onPreview: (patch: WindowPatch) => void;
  /** Ao soltar: grava. */
  onCommit: (patch: WindowPatch) => void;
  onClose: () => void;
}

export function WindowFrame({
  window: item,
  zoom,
  title,
  label,
  icon,
  focused,
  toneClass,
  children,
  onFocus,
  onPreview,
  onCommit,
  onClose,
  ...trigger
}: WindowFrameProps) {
  // O gesto vive num ref, não em estado: ele muda a cada quadro e nenhum
  // desses valores intermediários precisa causar render.
  const gesture = useRef<{
    mode: "move" | "resize";
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    originHeight: number;
    latest: WindowPatch;
  } | null>(null);

  const minimized = item.state === "minimized";

  const beginGesture = useCallback(
    (mode: "move" | "resize", event: React.PointerEvent<HTMLElement>) => {
      // Botão principal apenas: o secundário é do menu de contexto, e o do
      // meio é do pan da lousa.
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      onFocus();

      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = {
        mode,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: item.x,
        originY: item.y,
        originWidth: item.width,
        originHeight: item.height,
        latest: {},
      };
    },
    [item.x, item.y, item.width, item.height, onFocus]
  );

  const moveGesture = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;

      // Delta de tela dividido pelo zoom: numa lousa a 50%, dois pixels de
      // mouse são um pixel de lousa.
      const dx = (event.clientX - current.startX) / zoom;
      const dy = (event.clientY - current.startY) / zoom;

      const patch: WindowPatch =
        current.mode === "move"
          ? {
              x: snap(current.originX + dx),
              y: snap(current.originY + dy),
            }
          : {
              width: Math.max(MIN_WIDTH, snap(current.originWidth + dx)),
              height: Math.max(MIN_HEIGHT, snap(current.originHeight + dy)),
            };

      current.latest = patch;
      onPreview(patch);
    },
    [zoom, onPreview]
  );

  const endGesture = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;

      gesture.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);

      // Um clique sem arrastar não gera escrita nenhuma.
      if (Object.keys(current.latest).length > 0) onCommit(current.latest);
    },
    [onCommit]
  );

  const handleKeyMove = useCallback(
    (event: React.KeyboardEvent) => {
      const step = event.shiftKey ? 1 : KEYBOARD_STEP;
      const delta = {
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
      }[event.key];

      if (!delta) return;

      event.preventDefault();
      onCommit({ x: item.x + delta.x, y: item.y + delta.y });
    },
    [item.x, item.y, onCommit]
  );

  return (
    <article
      {...trigger}
      // Marca por onde a roda do mouse **não** deve arrastar a lousa: o que
      // rola aqui dentro (um PDF de vinte páginas, uma nota mais alta que a
      // janela) rola sozinho. Depois do spread, para nada de fora apagá-lo.
      data-board-window=""
      // `pointerdown` e não `click`: a janela precisa subir para a frente
      // no instante em que o dedo encosta, antes de qualquer arraste. Os
      // ouvintes do gatilho continuam valendo — os dois rodam, nesta ordem.
      onPointerDown={(event) => {
        trigger.onPointerDown?.(event);
        onFocus();
      }}
      onContextMenu={(event) => {
        onFocus();
        trigger.onContextMenu?.(event);
      }}
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        height: minimized ? undefined : item.height,
        zIndex: item.zIndex,
      }}
      className={cn(
        "group/window absolute flex flex-col overflow-hidden rounded-lg border-[0.5px] transition-shadow duration-200 motion-reduce:transition-none",
        toneClass ?? "border-border bg-background",
        focused
          ? "border-subtle-foreground shadow-[0_12px_40px_-12px] shadow-black/25"
          : "shadow-[0_4px_16px_-8px] shadow-black/15"
      )}
    >
      <header
        className={cn(
          "flex h-9 shrink-0 items-center gap-1 px-1",
          // A linha da barra de título é mais fraca que a moldura: ela separa
          // duas partes da mesma janela, não a janela do resto da lousa.
          !minimized && "border-b border-border/50"
        )}
      >
        {/* A alça é um botão: recebe foco, aparece na navegação por Tab e
            responde às setas. O arraste é um extra dela, não a única forma
            de mover a janela. */}
        <button
          type="button"
          onPointerDown={(event) => beginGesture("move", event)}
          onPointerMove={moveGesture}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onKeyDown={handleKeyMove}
          // O navegador tentaria rolar a página com o gesto; aqui o gesto é
          // nosso do começo ao fim.
          style={{ touchAction: "none" }}
          aria-label={`Mover ${title}. Use as setas para posicionar.`}
          className="flex h-7 min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg px-1.5 text-left active:cursor-grabbing"
        >
          {icon}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              label === title
                ? "font-semibold text-foreground"
                : // Rótulo de tipo é etiqueta, não conteúdo: peso e cor
                  // menores para ele não competir com o texto do corpo.
                  "font-medium text-subtle-foreground"
            )}
          >
            {label}
          </span>
        </button>

        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 transition-opacity duration-150 motion-reduce:transition-none",
            // Some quando a janela está em repouso e ninguém está nela: uma
            // lousa com vinte janelas não precisa de sessenta botões
            // competindo por atenção.
            focused
              ? "opacity-100"
              : "opacity-0 group-hover/window:opacity-100 group-focus-within/window:opacity-100"
          )}
        >
          <ChromeButton
            label={minimized ? `Expandir ${title}` : `Recolher ${title}`}
            onClick={() =>
              onCommit({ state: minimized ? "normal" : "minimized" })
            }
          >
            {minimized ? (
              <Square className="size-3" />
            ) : (
              <Minus className="size-3.5" />
            )}
          </ChromeButton>

          <ChromeButton label={`Fechar ${title}`} onClick={onClose}>
            <X className="size-3.5" />
          </ChromeButton>
        </div>
      </header>

      {!minimized && (
        <>
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

          {/* Alça de redimensionar. Também é botão, também responde às setas
              — com foco nela, as setas mudam largura e altura. */}
          <button
            type="button"
            onPointerDown={(event) => beginGesture("resize", event)}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 1 : KEYBOARD_STEP;
              const delta = {
                ArrowUp: { w: 0, h: -step },
                ArrowDown: { w: 0, h: step },
                ArrowLeft: { w: -step, h: 0 },
                ArrowRight: { w: step, h: 0 },
              }[event.key];
              if (!delta) return;
              event.preventDefault();
              onCommit({
                width: Math.max(MIN_WIDTH, item.width + delta.w),
                height: Math.max(MIN_HEIGHT, item.height + delta.h),
              });
            }}
            style={{ touchAction: "none" }}
            aria-label={`Redimensionar ${title}. Use as setas para ajustar.`}
            className="absolute right-0 bottom-0 flex size-6 cursor-nwse-resize items-center justify-center rounded-tl-lg text-subtle-foreground opacity-0 transition-opacity duration-150 group-hover/window:opacity-100 group-focus-within/window:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
          >
            <ResizeGrip />
          </button>
        </>
      )}
    </article>
  );
}

function ChromeButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // A barra de título inteira é área de arraste; sem isto o
      // `pointerdown` do botão viraria o começo de um gesto.
      onPointerDown={(event) => event.stopPropagation()}
      title={label}
      className="flex size-6 items-center justify-center rounded-md text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:size-8"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

/** Três riscos na diagonal — o sinal universal de "puxe daqui". */
function ResizeGrip() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" className="size-2.5">
      <path
        d="M9 1 1 9M9 5 5 9M9 9H9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}
