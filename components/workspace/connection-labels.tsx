"use client";

import { useEffect, useRef, useState } from "react";

import {
  ConnectionMenu,
  drawableConnections,
} from "@/components/workspace/connection-layer";
import { midpointOf } from "@/lib/workspace/connection-geometry";
import type { BoardConnection, BoardWindow } from "@/lib/workspace/queries";

/**
 * O que cada flecha diz, escrito em cima dela.
 *
 * **Camada de HTML, e não `<text>` do SVG.** O rótulo é editado no lugar, e
 * um campo de texto dentro de SVG só existe por `foreignObject` — que é HTML
 * de novo, com um envelope a mais e sem herdar nenhum dos tokens do tema. Em
 * HTML o chip é o mesmo componente na leitura e na edição, e o truncamento, o
 * anel de foco e a tipografia saem de graça.
 *
 * **Fica entre as flechas e as janelas.** Depois do SVG no fluxo, então pinta
 * por cima do traço; antes das janelas, que têm `z-index` próprio, então
 * some por baixo delas — um rótulo por cima de uma nota esconderia conteúdo
 * para explicar uma relação, o que é a troca errada.
 *
 * **A escala é desfeita.** O chip vive no plano transformado, para acompanhar
 * pan e zoom sem conta nenhuma, mas o texto dele é dividido pelo zoom: um
 * rótulo a 40% viraria três pixels de altura, e a 200% competiria com o
 * título das janelas. Mesmo princípio da espessura do traço.
 */

interface ConnectionLabelsProps {
  connections: BoardConnection[];
  windows: BoardWindow[];
  zoom: number;
  /** A ligação cujo campo está aberto. */
  editingId: string | null;
  onEdit: (id: string | null) => void;
  /** Texto vazio apaga o rótulo — a coluna volta a ser nula. */
  onCommit: (id: string, label: string) => void;
  /** O menu do chip é o mesmo da flecha, e ele também remove a ligação. */
  onRemove: (id: string) => void;
  /** Com a borracha ou a ligação na mão, o chip não recebe ponteiro. */
  inert: boolean;
}

export function ConnectionLabels({
  connections,
  windows,
  zoom,
  editingId,
  onEdit,
  onCommit,
  onRemove,
  inert,
}: ConnectionLabelsProps) {
  const drawn = drawableConnections(connections, windows, zoom).filter(
    ({ connection }) => connection.label || connection.id === editingId
  );
  if (drawn.length === 0) return null;

  return (
    <div className="pointer-events-none absolute top-0 left-0" aria-hidden={inert}>
      {drawn.map(({ connection, segment }) => {
        const at = midpointOf(segment);

        return (
          <div
            key={connection.id}
            style={{ left: at.x, top: at.y }}
            className="absolute"
          >
            <div
              style={{ transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
              className="origin-center"
            >
              {connection.id === editingId ? (
                <LabelField
                  initial={connection.label ?? ""}
                  onCommit={(value) => {
                    onCommit(connection.id, value);
                    onEdit(null);
                  }}
                  onCancel={() => onEdit(null)}
                />
              ) : (
                <LabelChip
                  connection={connection}
                  inert={inert}
                  onEdit={onEdit}
                  onRemove={onRemove}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A etiqueta em repouso.
 *
 * Dois cliques abrem o campo — é o gesto de renomear que a lousa já usa no
 * nome do workspace. O botão direito abre **o menu da ligação**, o mesmo do
 * traço: o chip fica bem em cima da flecha e receber ponteiro, e sem menu
 * próprio ele engoliria o botão direito justo onde a pessoa mira.
 *
 * Com uma ferramenta na mão o chip sai do caminho por inteiro: ali o gesto é
 * passar por cima, e um alvo clicável no meio do traço atrapalharia a
 * borracha em vez de ajudar.
 */
function LabelChip({
  connection,
  inert,
  onEdit,
  onRemove,
}: {
  connection: BoardConnection;
  inert: boolean;
  onEdit: (id: string | null) => void;
  onRemove: (id: string) => void;
}) {
  const chip = (
    <button
      type="button"
      // A barra de título não é o único lugar que começa um gesto: o fundo da
      // lousa também. Sem isto, tocar no chip arrastaria o plano inteiro.
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={() => onEdit(connection.id)}
      title="Dois cliques para mudar o texto"
      className={
        inert
          ? "pointer-events-none max-w-[14rem] truncate rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm"
          : "pointer-events-auto max-w-[14rem] cursor-text truncate rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors duration-150 hover:border-subtle-foreground hover:text-foreground motion-reduce:transition-none"
      }
    >
      {connection.label}
    </button>
  );

  if (inert) return chip;

  return (
    <ConnectionMenu
      id={connection.id}
      hasLabel
      onLabel={onEdit}
      onRemove={onRemove}
    >
      {chip}
    </ConnectionMenu>
  );
}

/**
 * O campo, enquanto ele está aberto.
 *
 * Enter grava, Esc desiste, sair do campo grava — as três saídas que um campo
 * de uma linha precisa ter. Gravar no `blur` é o que faz clicar noutro lugar
 * da lousa não perder o que a pessoa acabou de escrever; `escaping` é o que
 * impede o Esc de gravar assim mesmo, já que ele também tira o foco.
 */
function LabelField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const escaping = useRef(false);

  useEffect(() => {
    // Sem rolar nada para alcançar o campo: ele já está no meio da tela, e a
    // lousa é uma superfície recortada — ver "A lousa deslocada" no AGENTS.
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(value);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          // Não deixa o Esc chegar à lousa: lá ele guarda a ferramenta, e
          // fechar o campo já é a resposta inteira para esta tecla aqui.
          event.stopPropagation();
          escaping.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (escaping.current) return;
        onCommit(value);
      }}
      placeholder="o que liga as duas"
      maxLength={80}
      aria-label="Texto da ligação"
      className="pointer-events-auto w-40 rounded-full border border-subtle-foreground bg-background px-2 py-0.5 text-[11px] font-medium text-foreground shadow-sm outline-none placeholder:text-subtle-foreground"
    />
  );
}
