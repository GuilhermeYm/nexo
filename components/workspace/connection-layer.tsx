"use client";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemLabel,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  arrowHead,
  distanceToSegment,
  segmentBetween,
  type Point,
  type Segment,
} from "@/lib/workspace/connection-geometry";
import type { BoardConnection, BoardWindow } from "@/lib/workspace/queries";
import { cn } from "@/lib/utils";

/**
 * As flechas entre as janelas.
 *
 * Um SVG só, dentro do mesmo plano transformado das janelas — então pan e
 * zoom levam as flechas junto, de graça, sem recalcular nada a cada quadro.
 *
 * **`overflow: visible` com uma caixa de 1px.** A lousa vai de -200.000 a
 * 200.000 e tem coordenada negativa; um SVG dimensionado recortaria tudo que
 * ficasse fora dele. Com a caixa mínima e o recorte desligado, o desenho
 * acontece em coordenadas da lousa direto, sem `viewBox` para manter em
 * sincronia com nada.
 *
 * **A espessura divide pelo zoom.** O traço está dentro da transformação,
 * então a 40% um traço de 2px vira 0,8px e some. Dividir devolve a mesma
 * espessura aparente em qualquer altura da escala — mesmo princípio do zoom
 * multiplicativo.
 */

/** Espessura aparente do traço, em pixels de tela. */
const STROKE = 1.75;
/** Tamanho aparente da ponta. */
const HEAD = 11;
/** Faixa clicável em volta do traço — o traço sozinho é fino demais para mirar. */
const HIT = 14;

interface ConnectionLayerProps {
  connections: BoardConnection[];
  windows: BoardWindow[];
  zoom: number;
  /** A flecha que a borracha vai apagar se encostar agora. */
  markedId: string | null;
  onRemove: (id: string) => void;
  /** Enquanto a borracha está na mão, a flecha não abre menu nem recebe clique. */
  inert: boolean;
}

export function ConnectionLayer({
  connections,
  windows,
  zoom,
  markedId,
  onRemove,
  inert,
}: ConnectionLayerProps) {
  const drawn = drawableConnections(connections, windows);
  if (drawn.length === 0) return null;

  return (
    <svg
      width="1"
      height="1"
      style={{ overflow: "visible" }}
      className="pointer-events-none absolute top-0 left-0"
      aria-hidden="true"
    >
      {drawn.map(({ connection, segment }) => {
        const marked = markedId === connection.id;
        const path = `M ${segment.from.x} ${segment.from.y} L ${segment.to.x} ${segment.to.y}`;

        const arrow = (
          <g
            className={cn(
              "transition-colors duration-150 motion-reduce:transition-none",
              marked
                ? "text-error"
                : "text-subtle-foreground hover:text-foreground"
            )}
          >
            {/* A faixa de acerto: invisível, larga, e a única que recebe
                ponteiro. Sem ela seria preciso mirar num traço de 1,75px. */}
            {!inert && (
              <path
                d={path}
                stroke="transparent"
                strokeWidth={HIT / zoom}
                fill="none"
                className="pointer-events-auto cursor-context-menu"
              />
            )}
            <path
              d={path}
              stroke="currentColor"
              strokeWidth={STROKE / zoom}
              strokeLinecap="round"
              fill="none"
            />
            <path
              d={arrowHead(segment, HEAD / zoom)}
              stroke="currentColor"
              strokeWidth={STROKE / zoom}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>
        );

        // Com a borracha na mão a flecha não abre menu: ali o gesto é passar
        // por cima, e um menu de contexto no meio disso seria uma segunda
        // conversa por cima da primeira.
        if (inert) return <g key={connection.id}>{arrow}</g>;

        return (
          <ContextMenu key={connection.id}>
            <ContextMenuTrigger asChild>{arrow}</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => onRemove(connection.id)}>
                <UnlinkIcon />
                <ContextMenuItemLabel
                  label="Remover a ligação"
                  hint="Os dois elementos continuam onde estão."
                />
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </svg>
  );
}

/**
 * A ponta solta de uma ligação sendo desenhada.
 *
 * Sai da janela escolhida e vai até onde o ponteiro está. Tracejada e sem
 * ponta de flecha: ela ainda não é uma ligação, e mostrar o traço final
 * antes de ele existir faria a pessoa achar que já acabou.
 */
export function PendingConnection({
  from,
  to,
  zoom,
}: {
  from: BoardWindow;
  to: Point;
  zoom: number;
}) {
  const segment = segmentBetween(from, {
    ...to,
    width: 1,
    height: 1,
    state: "normal",
  });
  if (!segment) return null;

  return (
    <svg
      width="1"
      height="1"
      style={{ overflow: "visible" }}
      className="pointer-events-none absolute top-0 left-0 text-accent"
      aria-hidden="true"
    >
      <path
        d={`M ${segment.from.x} ${segment.from.y} L ${segment.to.x} ${segment.to.y}`}
        stroke="currentColor"
        strokeWidth={STROKE / zoom}
        strokeDasharray={`${6 / zoom} ${5 / zoom}`}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/* ---------------------------------------------------------------------- */

interface DrawnConnection {
  connection: BoardConnection;
  segment: Segment;
}

/**
 * As ligações que têm as duas pontas na tela e ainda sobram como traço.
 *
 * Uma ponta ausente acontece por um instante: a remoção otimista de uma
 * janela é aplicada antes de a resposta chegar, e nesse intervalo a flecha
 * ainda está na lista. Desenhar flecha para janela que não está mais aqui
 * seria pior do que não desenhar.
 */
function drawableConnections(
  connections: BoardConnection[],
  windows: BoardWindow[]
): DrawnConnection[] {
  const byId = new Map(windows.map((item) => [item.id, item]));

  return connections.flatMap((connection) => {
    const from = byId.get(connection.fromWindowId);
    const to = byId.get(connection.toWindowId);
    if (!from || !to) return [];

    const segment = segmentBetween(from, to);
    return segment ? [{ connection, segment }] : [];
  });
}

/**
 * Qual flecha está debaixo do ponteiro.
 *
 * Exportada porque quem pergunta é a borracha, lá na lousa: ela precisa saber
 * o que encostou, e a conta mora aqui, junto do resto da geometria. A margem
 * é dividida pelo zoom para valer sempre os mesmos pixels de tela.
 */
export function connectionAt(
  point: Point,
  connections: BoardConnection[],
  windows: BoardWindow[],
  zoom: number
): BoardConnection | null {
  const tolerance = HIT / zoom;
  let best: { connection: BoardConnection; distance: number } | null = null;

  for (const { connection, segment } of drawableConnections(
    connections,
    windows
  )) {
    const distance = distanceToSegment(point, segment);
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { connection, distance };
    }
  }

  return best?.connection ?? null;
}

/** Dois elos partidos — o sinal de "desligar". */
function UnlinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-subtle-foreground"
    >
      <path d="m18.84 12.25 1.72-1.71a4.24 4.24 0 0 0-6-6l-1.72 1.71" />
      <path d="m5.17 11.75-1.71 1.71a4.24 4.24 0 0 0 6 6l1.71-1.71" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
