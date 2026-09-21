"use client";

import { Minus, Square, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import type { WindowPatch } from "@/hooks/use-board-windows";
import type { BoardWindow } from "@/lib/workspace/queries";
import { COLLAPSED_WINDOW_WIDTH } from "@/lib/workspace/window-sizes";
import { cn } from "@/lib/utils";

/** Conjunto vazio compartilhado para selectedWindowIds default. */
const EMPTY_SET: ReadonlySet<string> = new Set();

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
  /**
   * Modo de leitura: nada aqui move, redimensiona, recolhe ou fecha. Só o
   * foco (que muda a ordem, não o conteúdo) continua de pé — é o que deixa
   * ler uma janela coberta por outra.
   */
  readOnly?: boolean;
  children: ReactNode;
  onFocus: () => void;
  /** Durante o gesto: só estado local. */
  onPreview: (patch: WindowPatch) => void;
  /** Ao soltar: grava. */
  onCommit: (patch: WindowPatch) => void;
  onClose: () => void;
  /** Se esta janela está no grupo selecionado. */
  isSelected?: boolean;
  /** Move o grupo inteiro de janelas selecionadas. */
  onMoveGroup?: (ids: string[], dx: number, dy: number) => void;
  /** Fecha a passada: a "foto" de origem do grupo vale só até aqui. */
  onMoveGroupEnd?: () => void;
  /** IDs de todas as janelas selecionadas (para mover em bloco). */
  selectedWindowIds?: ReadonlySet<string>;
}

export function WindowFrame({
  window: item,
  zoom,
  title,
  label,
  icon,
  focused,
  toneClass,
  readOnly = false,
  children,
  onFocus,
  onPreview,
  onCommit,
  onClose,
  isSelected = false,
  onMoveGroup,
  onMoveGroupEnd,
  selectedWindowIds = EMPTY_SET,
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
  // Eventos de ponteiro podem chegar mais rápido que a tela consegue pintar.
  // Um único preview por quadro evita enfileirar renders da lousa inteira e
  // mantém o último movimento — justamente o que o olho precisa acompanhar.
  const previewFrame = useRef<number | null>(null);
  const pendingPreview = useRef<WindowPatch | null>(null);
  /**
   * Um gesto em andamento.
   *
   * É estado, e não só o `ref` acima, porque a moldura **muda de aparência**
   * enquanto ela está sendo mexida: as transições saem do caminho e a camada
   * é promovida. Dois renders por gesto inteiro, não dois por quadro.
   */
  const [gesturing, setGesturing] = useState(false);

  const flushPreview = useCallback(() => {
    if (previewFrame.current !== null) {
      cancelAnimationFrame(previewFrame.current);
      previewFrame.current = null;
    }
    const patch = pendingPreview.current;
    pendingPreview.current = null;
    if (patch) onPreview(patch);
  }, [onPreview]);

  useEffect(
    () => () => {
      if (previewFrame.current !== null) {
        cancelAnimationFrame(previewFrame.current);
      }
    },
    []
  );

  const minimized = item.state === "minimized";
  // Só a caixa de texto oferece isto — ver o inspetor de propriedades.
  const borderless = item.kind === "text" && item.content?.borderless === true;
  const chromeHidden = borderless && !focused && !minimized;

  const beginGesture = useCallback(
    (mode: "move" | "resize", event: React.PointerEvent<HTMLElement>) => {
      // No modo de leitura, o gesto nem começa — e o evento segue borbulhando
      // até o `article`, que ainda traz a janela para frente sozinho.
      if (readOnly) return;
      // Botão principal apenas: o secundário é do menu de contexto, e o do
      // meio é do pan da lousa.
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      onFocus();

      event.currentTarget.setPointerCapture(event.pointerId);
      setGesturing(true);
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
    [item.x, item.y, item.width, item.height, onFocus, readOnly]
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
      pendingPreview.current = patch;
      if (previewFrame.current === null) {
        previewFrame.current = requestAnimationFrame(() => {
          previewFrame.current = null;
          const next = pendingPreview.current;
          pendingPreview.current = null;
          if (next) onPreview(next);
        });
      }

      // Se a janela arrastada está no grupo selecionado, move o grupo junto.
      if (
        isSelected &&
        current.mode === "move" &&
        onMoveGroup &&
        selectedWindowIds.size > 1 &&
        (dx !== 0 || dy !== 0)
      ) {
        onMoveGroup(Array.from(selectedWindowIds), dx, dy);
      }
    },
    [zoom, onPreview, isSelected, onMoveGroup, selectedWindowIds]
  );

  const endGesture = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;

      // A "foto" do grupo (ver `moveGesture`) vale só para esta passada — a
      // próxima tira a dela. Sem isto, um segundo arraste reaproveitaria
      // posições de origem de um gesto que já acabou.
      if (isSelected && current.mode === "move") onMoveGroupEnd?.();

      gesture.current = null;
      setGesturing(false);
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      // Garante que a posição visual final e a posição persistida sejam a
      // mesma mesmo quando a pessoa solta entre dois quadros de animação.
      flushPreview();

      // Um clique sem arrastar não gera escrita nenhuma.
      if (Object.keys(current.latest).length > 0) onCommit(current.latest);
    },
    [flushPreview, onCommit, isSelected, onMoveGroupEnd]
  );

  const handleKeyMove = useCallback(
    (event: React.KeyboardEvent) => {
      if (readOnly) return;
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
    [item.x, item.y, onCommit, readOnly]
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
        /**
         * A posição sai por `transform`, e não por `left`/`top`.
         *
         * São dois caminhos diferentes no navegador: `left`/`top` mudam a
         * caixa e obrigam a um recálculo de layout **do plano inteiro** a
         * cada quadro do arraste; `transform` é composição, e roda fora da
         * linha principal. Numa lousa com uma dúzia de janelas é a diferença
         * entre a janela acompanhar o ponteiro e ela chegar atrasada.
         *
         * Ninguém aqui mede a janela pelo DOM — a borracha, as flechas e o
         * realce da ferramenta leem `item.x`/`item.y` do estado —, então
         * trocar a caixa pela transformação não muda resposta nenhuma.
         */
        transform: `translate3d(${item.x}px, ${item.y}px, 0)`,
        // Recolhida, a janela vira uma etiqueta com o ícone e o nome. A
        // largura guardada é a de quando ela reabrir — ver `frameWidthOf`,
        // que mantém a borracha e as flechas mirando o que se vê.
        width: minimized ? COLLAPSED_WINDOW_WIDTH : item.width,
        height: minimized ? undefined : item.height,
        zIndex: item.zIndex,
        // Só durante o gesto: promover as janelas todas, o tempo todo, custa
        // memória de vídeo e não acelera nada em repouso.
        willChange: gesturing ? "transform" : undefined,
      }}
      className={cn(
        "group/window absolute top-0 left-0 flex flex-col overflow-hidden rounded-lg border-[0.5px] motion-reduce:transition-none",
        /**
         * A transição **nunca** alcança a posição, e sai inteira do caminho
         * durante o gesto.
         *
         * Era `transition-all duration-200`, e isso fazia o navegador
         * interpolar cada quadro do arraste por 200ms: a janela saía atrás do
         * ponteiro, o movimento parecia emborrachado e soltar deixava ela
         * ainda andando. O que continua animado é a moldura — borda, fundo e
         * a sombra do foco — e o tamanho ao recolher/expandir, que mudam por
         * clique e não por quadro.
         */
        gesturing
          ? "transition-none"
          : "transition-[border-color,background-color,box-shadow,padding,width,height] duration-200",
        borderless
          ? focused
            ? "border-border/60 bg-background/80 p-1.5 shadow-[0_12px_40px_-12px] shadow-black/25 backdrop-blur-sm"
            : "border-transparent bg-transparent p-0 shadow-none"
          : cn(
              toneClass ?? "border-border bg-background",
              focused
                ? "border-subtle-foreground shadow-[0_12px_40px_-12px] shadow-black/25"
                : "shadow-[0_4px_16px_-8px] shadow-black/15"
            )
      )}
    >
      <header
        className={cn(
          "flex h-9 shrink-0 items-center gap-1 px-1 transition-opacity duration-150 motion-reduce:transition-none",
          // A linha da barra de título é mais fraca que a moldura: ela separa
          // duas partes da mesma janela, não a janela do resto da lousa.
          !minimized && "border-b border-border/50",
          // Sem moldura, a barra some com o resto do quadro — e volta junto
          // com ele, ao passar o mouse ou focar, para o arraste e os botões
          // continuarem alcançáveis.
          chromeHidden &&
            "opacity-0 group-hover/window:opacity-100 group-focus-within/window:opacity-100"
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
          aria-label={
            readOnly ? title : `Mover ${title}. Use as setas para posicionar.`
          }
          className={cn(
            "flex h-7 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left",
            readOnly ? "cursor-default" : "cursor-grab active:cursor-grabbing"
          )}
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

        {/* No modo de leitura, só "Expandir" continua — sem ela uma janela
            recolhida antes de entrar no modo ficaria escondida para sempre,
            e ler é exatamente o que o modo promete. "Recolher" e "Fechar"
            tiram conteúdo de vista; por isso somem. */}
        {(!readOnly || minimized) && (
          <div
            className={cn(
              "flex shrink-0 items-center gap-0.5 transition-opacity duration-150 motion-reduce:transition-none",
              // Some quando a janela está em repouso e ninguém está nela: uma
              // lousa com vinte janelas não precisa de sessenta botões
              // competindo por atenção. Recolhida é a exceção — sem o botão de
              // expandir à vista, a única saída seria o menu do botão direito.
              focused || minimized
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

            {!readOnly && (
              <ChromeButton label={`Fechar ${title}`} onClick={onClose}>
                <X className="size-3.5" />
              </ChromeButton>
            )}
          </div>
        )}
      </header>

      {!minimized && (
        <>
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

          {/* Alça de redimensionar. Também é botão, também responde às setas
              — com foco nela, as setas mudam largura e altura. */}
          {!readOnly && (
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
          )}
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
