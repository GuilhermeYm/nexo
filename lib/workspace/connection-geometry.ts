import { frameHeightOf } from "@/lib/workspace/window-sizes";

/**
 * Onde uma flecha começa e onde ela termina.
 *
 * Nada disto é guardado no banco. A posição das janelas já está lá, e uma
 * segunda cópia dela dentro da ligação ficaria velha no primeiro arraste —
 * a flecha continuaria desenhada onde a janela estava. Calcular a cada
 * quadro custa duas subtrações e uma divisão.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  state: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  from: Point;
  to: Point;
}

/**
 * O segmento entre duas janelas, já recortado nas bordas.
 *
 * A reta liga os dois centros, mas ninguém quer ver a flecha atravessando a
 * janela: o que se desenha é o pedaço entre a borda de uma e a borda da
 * outra. `clipToBorder` faz esse recorte.
 *
 * Devolve `null` quando as duas se sobrepõem a ponto de não sobrar segmento —
 * desenhar uma flecha de dois pixels ali seria sujeira, não informação.
 */
export function segmentBetween(from: Rect, to: Rect): Segment | null {
  const a = centerOf(from);
  const b = centerOf(to);

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return null;

  const start = clipToBorder(a, { x: dx, y: dy }, from);
  const end = clipToBorder(b, { x: -dx, y: -dy }, to);

  // Sobrou menos que a ponta da flecha: as janelas estão praticamente uma
  // sobre a outra.
  if (Math.hypot(end.x - start.x, end.y - start.y) < 8) return null;

  return { from: start, to: end };
}

export function centerOf(rect: Rect): Point {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + frameHeightOf(rect) / 2,
  };
}

/**
 * Do centro até a borda, na direção pedida.
 *
 * A conta é a do retângulo: o quanto dá para andar em cada eixo antes de sair
 * dele, e o menor dos dois manda. É o que faz a flecha encostar no lado que
 * está de frente para a outra janela sem ninguém ter que escolher um lado.
 */
function clipToBorder(center: Point, direction: Point, rect: Rect): Point {
  const halfWidth = rect.width / 2;
  const halfHeight = frameHeightOf(rect) / 2;

  const scaleX = direction.x === 0 ? Infinity : halfWidth / Math.abs(direction.x);
  const scaleY =
    direction.y === 0 ? Infinity : halfHeight / Math.abs(direction.y);
  const scale = Math.min(scaleX, scaleY);

  return {
    x: center.x + direction.x * scale,
    y: center.y + direction.y * scale,
  };
}

/**
 * A ponta da flecha, como três pontos.
 *
 * Desenhada à mão em vez de por `<marker>`: o marcador do SVG herda estilo do
 * próprio marcador, não de quem o referencia, e acertar a cor dele nos dois
 * temas custaria mais do que estas quatro linhas de trigonometria. De quebra,
 * o tamanho passa a ser nosso — e ele precisa compensar o zoom da lousa.
 */
export function arrowHead(segment: Segment, size: number): string {
  const angle = Math.atan2(
    segment.to.y - segment.from.y,
    segment.to.x - segment.from.x
  );
  const spread = Math.PI / 7;

  const left = {
    x: segment.to.x - size * Math.cos(angle - spread),
    y: segment.to.y - size * Math.sin(angle - spread),
  };
  const right = {
    x: segment.to.x - size * Math.cos(angle + spread),
    y: segment.to.y - size * Math.sin(angle + spread),
  };

  return `M ${left.x} ${left.y} L ${segment.to.x} ${segment.to.y} L ${right.x} ${right.y}`;
}

/**
 * Distância de um ponto ao segmento — é com ela que a borracha decide se
 * encostou numa flecha.
 *
 * Ponto-ao-segmento, e não ponto-à-reta: a reta é infinita, e passar longe
 * das duas janelas, no prolongamento da flecha, apagaria uma ligação que a
 * pessoa nem estava vendo ali.
 */
export function distanceToSegment(point: Point, segment: Segment): number {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - segment.from.x, point.y - segment.from.y);
  }

  // Onde a projeção do ponto cai no segmento, presa entre as duas pontas.
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - segment.from.x) * dx + (point.y - segment.from.y) * dy) /
        lengthSquared
    )
  );

  return Math.hypot(
    point.x - (segment.from.x + t * dx),
    point.y - (segment.from.y + t * dy)
  );
}
