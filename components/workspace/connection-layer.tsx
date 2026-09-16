"use client";

import { memo } from "react";

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
import {
  CONNECTION_TONE_CLASS,
  WEIGHT_PX,
  dashArrayOf,
  type ConnectionHeads,
  type ConnectionStroke,
  type ConnectionTone,
  type ConnectionWeight,
} from "@/lib/workspace/connection-style";
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
 *
 * **Cada flecha é memoizada.** Arrastar uma janela dispara um render por
 * quadro na lousa inteira, e cada flecha carrega um `ContextMenu` do Radix —
 * uma árvore de contextos, camadas e ids. Sem o `memo`, mover uma janela
 * remontava o menu de **todas** as flechas sessenta vezes por segundo, e o
 * arraste engasgava em proporção ao número de ligações. Com props primitivas,
 * só as duas ou três flechas que encostam na janela arrastada re-renderizam.
 */

/** Espessura aparente do traço provisório, em pixels de tela. */
const STROKE = WEIGHT_PX.regular;
/** Tamanho aparente da ponta, no traço médio. Cresce com a espessura. */
const HEAD = 11;
/** Faixa clicável em volta do traço — o traço sozinho é fino demais para mirar. */
const HIT = 14;
/**
 * Folga aparente entre a borda da janela e a ponta da flecha.
 *
 * Encostada, a flecha vira parte da moldura: o olho lê um retângulo com um
 * espeto em vez de duas coisas ligadas. Doze pixels são o bastante para a
 * relação se separar dos objetos sem a flecha parecer solta no meio do nada.
 */
const GAP = 12;
/**
 * Distância aparente entre as duas flechas de um par recíproco.
 *
 * A→B e B→A são duas linhas de propósito, e sem separá-las a lousa desenhava
 * uma em cima da outra: uma flecha só, com ponta dos dois lados, e o botão
 * direito sempre pegando a mesma das duas.
 */
const SEPARATION = 9;

interface ConnectionLayerProps {
  connections: BoardConnection[];
  windows: BoardWindow[];
  zoom: number;
  /** A flecha que a borracha vai apagar se encostar agora. */
  markedId: string | null;
  /** A flecha aberta no inspetor. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  /** Abre o campo de rótulo desta flecha. */
  onLabel: (id: string) => void;
  /** Enquanto a borracha está na mão, a flecha não abre menu nem recebe clique. */
  inert: boolean;
}

export function ConnectionLayer({
  connections,
  windows,
  zoom,
  markedId,
  selectedId,
  onSelect,
  onRemove,
  onLabel,
  inert,
}: ConnectionLayerProps) {
  const drawn = drawableConnections(connections, windows, zoom);
  if (drawn.length === 0) return null;

  return (
    <svg
      width="1"
      height="1"
      style={{ overflow: "visible" }}
      className="pointer-events-none absolute top-0 left-0"
      aria-hidden="true"
    >
      {drawn.map(({ connection, segment }) => (
        <ConnectionArrow
          key={connection.id}
          id={connection.id}
          hasLabel={Boolean(connection.label)}
          tone={connection.tone}
          stroke={connection.stroke}
          weight={connection.weight}
          heads={connection.heads}
          x1={segment.from.x}
          y1={segment.from.y}
          x2={segment.to.x}
          y2={segment.to.y}
          zoom={zoom}
          marked={markedId === connection.id}
          selected={selectedId === connection.id}
          inert={inert}
          onSelect={onSelect}
          onRemove={onRemove}
          onLabel={onLabel}
        />
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------------------- */

interface ArrowProps {
  id: string;
  hasLabel: boolean;
  tone: ConnectionTone | null;
  stroke: ConnectionStroke;
  weight: ConnectionWeight;
  heads: ConnectionHeads;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  zoom: number;
  marked: boolean;
  selected: boolean;
  inert: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onLabel: (id: string) => void;
}

/**
 * Uma flecha. Props primitivas de propósito: é o que faz o `memo` valer
 * alguma coisa — um objeto `segment` novo a cada quadro passaria por todas as
 * comparações.
 */
const ConnectionArrow = memo(function ConnectionArrow({
  id,
  hasLabel,
  tone,
  stroke,
  weight,
  heads,
  x1,
  y1,
  x2,
  y2,
  zoom,
  marked,
  selected,
  inert,
  onSelect,
  onRemove,
  onLabel,
}: ArrowProps) {
  const segment: Segment = { from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
  const reversed: Segment = { from: segment.to, to: segment.from };
  const path = `M ${x1} ${y1} L ${x2} ${y2}`;

  const width = WEIGHT_PX[weight] / zoom;
  // A ponta acompanha a espessura, mas devagar: proporcional, uma flecha
  // grossa ganharia uma ponta do tamanho de um ícone.
  const head = (HEAD + (WEIGHT_PX[weight] - WEIGHT_PX.regular) * 2) / zoom;
  const dash = dashArrayOf(stroke, width);

  const arrow = (
    <g
      // Identidade no DOM. Um traço de SVG é indistinguível de qualquer ícone
      // da tela para quem olha de fora — inclusive para o roteiro de
      // verificação, que contava as alças de redimensionar junto com as
      // flechas.
      data-connection={id}
      data-selected={selected || undefined}
      className={cn(
        "transition-colors duration-150 motion-reduce:transition-none",
        marked
          ? "text-error"
          : tone
            ? CONNECTION_TONE_CLASS[tone]
            : "text-subtle-foreground hover:text-foreground"
      )}
    >
      {/* Selecionada: um halo discreto por trás do traço. Por trás, e não
          trocando a cor, porque a cor é escolha da pessoa — e é justamente o
          que ela está ajustando no inspetor. Sem marcas nas pontas: elas
          brigariam com as pontas de flecha. */}
      {selected && !marked && (
        <path
          d={path}
          stroke="currentColor"
          strokeOpacity={0.16}
          strokeWidth={width + 6 / zoom}
          strokeLinecap="round"
          fill="none"
          className="text-accent"
          aria-hidden="true"
        />
      )}
      {/* A faixa de acerto: invisível, larga, e a única que recebe ponteiro.
          Sem ela seria preciso mirar num traço de 1,75px. */}
      {!inert && (
        <path
          d={path}
          stroke="transparent"
          strokeWidth={Math.max(HIT / zoom, width + 8 / zoom)}
          fill="none"
          onClick={() => onSelect(id)}
          onDoubleClick={() => onLabel(id)}
          className="pointer-events-auto cursor-pointer"
        />
      )}
      <path
        d={path}
        stroke="currentColor"
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinecap="round"
        fill="none"
      />
      {heads !== "none" && (
        <path
          d={arrowHead(segment, head)}
          stroke="currentColor"
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
      {heads === "both" && (
        <path
          d={arrowHead(reversed, head)}
          stroke="currentColor"
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </g>
  );

  // Com a borracha na mão a flecha não abre menu: ali o gesto é passar por
  // cima, e um menu de contexto no meio disso seria uma segunda conversa por
  // cima da primeira.
  if (inert) return arrow;

  return (
    <ConnectionMenu
      id={id}
      hasLabel={hasLabel}
      onSelect={onSelect}
      onLabel={onLabel}
      onRemove={onRemove}
    >
      {arrow}
    </ConnectionMenu>
  );
});

/**
 * O menu do botão direito de uma ligação.
 *
 * Vive fora da flecha porque **o rótulo também precisa dele**. O chip é
 * desenhado no meio do traço e recebe ponteiro; sem menu próprio, ele engolia
 * o botão direito exatamente no ponto em que a pessoa mira quando quer mexer
 * na ligação — e a única saída era acertar o traço ao lado da etiqueta.
 *
 * Um componente, e não dois blocos iguais: um item acrescentado num lugar e
 * esquecido no outro faria a mesma flecha oferecer coisas diferentes conforme
 * onde se clica.
 */
export function ConnectionMenu({
  id,
  hasLabel,
  onSelect,
  onLabel,
  onRemove,
  children,
}: {
  id: string;
  hasLabel: boolean;
  onSelect: (id: string) => void;
  onLabel: (id: string) => void;
  onRemove: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onSelect(id)}>
          <SlidersIcon />
          <ContextMenuItemLabel
            label="Editar a ligação"
            hint="Cor, traço, espessura e pontas."
          />
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onLabel(id)}>
          <TagIcon />
          <ContextMenuItemLabel
            label={hasLabel ? "Mudar o texto" : "Escrever na ligação"}
            hint="Uma palavra sobre o que liga as duas."
          />
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onRemove(id)}>
          <UnlinkIcon />
          <ContextMenuItemLabel
            label="Remover a ligação"
            hint="Os dois elementos continuam onde estão."
          />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/* ---------------------------------------------------------------------- */

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
  const segment = segmentBetween(
    from,
    { ...to, width: 1, height: 1, state: "normal" },
    // A mesma folga da flecha pronta, só na saída: a ponta livre é o ponteiro,
    // e afastar o traço do cursor faria o desenho parecer atrasado.
    { gap: GAP / zoom }
  );
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

export interface DrawnConnection {
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
 *
 * Exportada porque três lugares precisam exatamente da mesma geometria: o
 * desenho, os rótulos e a borracha. Calculá-la em cada um daria três versões
 * da mesma conta, e a folga aplicada num e não no outro faria a borracha
 * mirar onde não há traço.
 */
export function drawableConnections(
  connections: BoardConnection[],
  windows: BoardWindow[],
  zoom: number
): DrawnConnection[] {
  const byId = new Map(windows.map((item) => [item.id, item]));
  const pairs = new Set(
    connections.map((item) => `${item.fromWindowId}>${item.toWindowId}`)
  );

  const gap = GAP / zoom;

  return connections.flatMap((connection) => {
    const from = byId.get(connection.fromWindowId);
    const to = byId.get(connection.toWindowId);
    if (!from || !to) return [];

    // O par recíproco existe? Então as duas se afastam do eixo, meia folga
    // cada uma.
    //
    // **Sem sinal.** A tentação é dar `+` a uma e `−` à outra pela ordem dos
    // ids, e isso as devolve exatamente uma em cima da outra: o deslocamento é
    // perpendicular à direção do **próprio** traço, e A→B e B→A apontam para
    // lados opostos. Os dois sinais invertidos se cancelam. Deslocando as duas
    // para a esquerda de si mesmas, elas caem em lados opostos do eixo
    // sozinhas — e cada tela chega ao mesmo desenho sem combinar nada.
    const reciprocal = pairs.has(
      `${connection.toWindowId}>${connection.fromWindowId}`
    );
    const shift = reciprocal ? SEPARATION / zoom / 2 : 0;

    const segment = segmentBetween(from, to, { gap, shift });
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
    windows,
    zoom
  )) {
    const distance = distanceToSegment(point, segment);
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { connection, distance };
    }
  }

  return best?.connection ?? null;
}

/** Controles deslizantes — o sinal de "ajustar". */
function SlidersIcon() {
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
      <path d="M10 5H3" />
      <path d="M12 19H3" />
      <path d="M14 3v4" />
      <path d="M16 17v4" />
      <path d="M21 12h-9" />
      <path d="M21 19h-5" />
      <path d="M21 5h-7" />
      <path d="M8 10v4" />
      <path d="M8 12H3" />
    </svg>
  );
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

/** Uma etiqueta pendurada — o sinal de "escrever aqui". */
function TagIcon() {
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
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  );
}
