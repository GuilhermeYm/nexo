import { frameHeightOf, frameWidthOf } from "@/lib/workspace/window-sizes";

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

export interface SegmentOptions {
  /**
   * Folga entre a borda da janela e a ponta do traço, em unidades de lousa.
   *
   * Uma flecha encostada na moldura vira parte dela: o olho lê um retângulo
   * com um espeto, não duas coisas ligadas. A folga é o que separa a relação
   * dos objetos que ela relaciona — e é ela que dá lugar ao rótulo perto da
   * ponta sem que o texto caia por cima da janela.
   */
  gap?: number;
  /**
   * Deslocamento perpendicular ao traço, em unidades de lousa.
   *
   * Existe por causa do par recíproco: A→B e B→A são duas linhas de
   * propósito (duas coisas podem apontar uma para a outra), e sem isto elas
   * são desenhadas **exatamente uma em cima da outra** — a lousa mostra uma
   * flecha só, com ponta nos dois lados, e o botão direito sempre pega a
   * mesma das duas. Meia folga para cada lado torna as duas visíveis e
   * clicáveis em separado.
   */
  shift?: number;
}

/**
 * O segmento entre duas janelas, já recortado nas bordas e afastado delas.
 *
 * A reta liga os dois centros, mas ninguém quer ver a flecha atravessando a
 * janela: o que se desenha é o pedaço entre a borda de uma e a borda da
 * outra, encolhido pela folga nas duas pontas. `clipToBorder` faz o recorte.
 *
 * Devolve `null` quando as duas se sobrepõem a ponto de não sobrar segmento —
 * desenhar uma flecha de dois pixels ali seria sujeira, não informação.
 */
export function segmentBetween(
  from: Rect,
  to: Rect,
  options: SegmentOptions = {}
): Segment | null {
  const a = centerOf(from);
  const b = centerOf(to);

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return null;

  const start = clipToBorder(a, { x: dx, y: dy }, from);
  const end = clipToBorder(b, { x: -dx, y: -dy }, to);

  const span = Math.hypot(end.x - start.x, end.y - start.y);
  // Sobrou menos que a ponta da flecha: as janelas estão praticamente uma
  // sobre a outra.
  if (span < MIN_SPAN) return null;

  // A direção do traço recortado, e não a dos centros: com o deslocamento
  // aplicado as duas divergem, e é a do traço que a ponta da flecha segue.
  const ux = (end.x - start.x) / span;
  const uy = (end.y - start.y) / span;

  // A folga nunca come o traço inteiro: numa lousa apertada é melhor uma
  // flecha curta encostada do que flecha nenhuma. Sobra sempre `MIN_SPAN`.
  const gap = Math.min(options.gap ?? 0, Math.max(0, (span - MIN_SPAN) / 2));
  const shift = options.shift ?? 0;

  // Perpendicular à direção — o giro de 90° é (x, y) → (-y, x).
  const px = -uy * shift;
  const py = ux * shift;

  return {
    from: { x: start.x + ux * gap + px, y: start.y + uy * gap + py },
    to: { x: end.x - ux * gap + px, y: end.y - uy * gap + py },
  };
}

/** Abaixo disto não sobra traço para ver nem para mirar. */
const MIN_SPAN = 8;

/** O meio do traço — é onde o rótulo mora. */
export function midpointOf(segment: Segment): Point {
  return {
    x: (segment.from.x + segment.to.x) / 2,
    y: (segment.from.y + segment.to.y) / 2,
  };
}

export function centerOf(rect: Rect): Point {
  return {
    x: rect.x + frameWidthOf(rect) / 2,
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
  const halfWidth = frameWidthOf(rect) / 2;
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

/* ---------------------------------------------------------------------- */
/* A curva: o ponto do meio                                               */
/* ---------------------------------------------------------------------- */

/**
 * O deslocamento perpendicular máximo de uma curva, em unidades de lousa.
 *
 * O mesmo teto do CHECK de `bend_offset` (0034) e do Zod da rota PATCH: um
 * valor maior é recusado pelo banco, então `bendFromPoint` prende o arraste
 * aqui em vez de montar um PATCH que volta 400.
 */
export const MAX_BEND_OFFSET = 20_000;

/**
 * Onde a alça pode ficar, ao longo da reta.
 *
 * **Mais estreito que o CHECK do banco, de propósito.** A coluna aceita
 * `0..1` porque ali é o domínio do valor; aqui é o que dá para desenhar, e
 * as duas coisas não são a mesma. Uma curva quadrática está presa nas duas
 * pontas: em `t = 0` ela *é* a ponta de saída, e nenhum ponto de controle a
 * faz passar por um lugar afastado dali. Pedir isso resolve a inversão de
 * `bendControlOf` dividindo por `2t(1 − t)`, que tende a zero — o controle
 * vai para o infinito e o traço some da tela.
 *
 * Por isso a trava é aplicada **na entrada das três funções**, e não só no
 * controle: se a alça fosse desenhada no `t` cru e a curva resolvida no `t`
 * preso, as duas falariam de pontos diferentes e a alça ficaria fora da
 * própria curva justamente nos extremos. Uma trava só, e as três concordam.
 *
 * Uma linha que já traga `bend_t = 0` (escrita por outra versão, ou à mão)
 * não quebra nada: ela é desenhada em `0.05`.
 */
const BEND_T_MIN = 0.05;
const BEND_T_MAX = 0.95;

/** O `bendT` como o desenho o usa. Nulo — a ligação reta — é o meio. */
function drawableBendT(bendT: number | null): number {
  if (bendT === null || !Number.isFinite(bendT)) return 0.5;
  return Math.min(BEND_T_MAX, Math.max(BEND_T_MIN, bendT));
}

/** O `bendOffset` como o desenho o usa. Nulo é sem barriga: a reta. */
function drawableBendOffset(bendOffset: number | null): number {
  if (bendOffset === null || !Number.isFinite(bendOffset)) return 0;
  return Math.min(MAX_BEND_OFFSET, Math.max(-MAX_BEND_OFFSET, bendOffset));
}

/**
 * O ponto do meio de uma ligação curva, no espaço do segmento recebido.
 *
 * ## Assinatura
 *
 * ```ts
 * bendPointOf(segment: Segment, bendT: number | null, bendOffset: number | null): Point
 * ```
 *
 * - `segment` — o traço **já recortado nas bordas e já deslocado**, isto é, o
 *   que `segmentBetween` devolveu e que está sendo desenhado. Tem de ser o
 *   mesmo nas três funções deste bloco: medir numa reta e desenhar noutra
 *   devolve a curva deslocada da alça que a pessoa está segurando.
 * - `bendT` — a posição **ao longo da reta**: `0` é a ponta de saída, `1` a de
 *   chegada. Nulo (a ligação sem curva) vale `0.5`, o meio. Preso a
 *   `BEND_T_MIN..BEND_T_MAX` — ver o porquê lá.
 * - `bendOffset` — o deslocamento **perpendicular à reta**, em unidades de
 *   lousa. Nulo vale `0`. O sinal segue a mesma perpendicular do `shift` do
 *   par recíproco — o giro de 90° é `(x, y) → (-y, x)`.
 * - Devolve o ponto no mesmo espaço do segmento (a lousa aplica o zoom na
 *   camada, não aqui).
 *
 * Nada disto é coordenada absoluta, e é o ponto inteiro do desenho: guardados
 * `bendT` e `bendOffset` em vez de um `x, y`, a curva continua com a mesma
 * cara depois que a janela for arrastada. Um par de coordenadas ficaria velho
 * no primeiro arraste, como a posição das pontas já ficaria — é o mesmo
 * argumento do topo deste arquivo, aplicado ao meio do traço.
 *
 * Com `bendT` e `bendOffset` nulos, o resultado é exatamente `midpointOf` — a
 * ligação de sempre, sem mudança nenhuma.
 */
export function bendPointOf(
  segment: Segment,
  bendT: number | null,
  bendOffset: number | null
): Point {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const span = Math.hypot(dx, dy);

  const t = drawableBendT(bendT);
  const offset = drawableBendOffset(bendOffset);

  // Sem comprimento não há direção, e sem direção não há perpendicular: o
  // ponto do meio é a própria ponta. Não acontece com um segmento vindo de
  // `segmentBetween` (ele devolve `null` abaixo de `MIN_SPAN`), mas quem
  // chama pode ter um traço em construção na mão.
  if (span === 0) return { x: segment.from.x, y: segment.from.y };

  const ux = dx / span;
  const uy = dy / span;

  return {
    x: segment.from.x + dx * t - uy * offset,
    y: segment.from.y + dy * t + ux * offset,
  };
}

/**
 * O ponto de controle da curva quadrática que **passa** pelo ponto do meio.
 *
 * ## Assinatura
 *
 * ```ts
 * bendControlOf(segment: Segment, bendT: number | null, bendOffset: number | null): Point
 * ```
 *
 * Mesmos argumentos de `bendPointOf`, mesmo espaço de saída. É este o ponto
 * que vai no `Q` do `<path>`:
 *
 * ```ts
 * const bend = bendPointOf(segment, c.bendT, c.bendOffset);     // a alça
 * const control = bendControlOf(segment, c.bendT, c.bendOffset); // o "Q"
 * const d = `M ${segment.from.x} ${segment.from.y} Q ${control.x} ${control.y} ${segment.to.x} ${segment.to.y}`;
 * ```
 *
 * As duas são funções diferentes de propósito, e usar uma no lugar da outra é
 * o engano que mais custa aqui: numa quadrática o ponto de controle **não
 * fica sobre a curva** — em `t = 0.5` a curva passa a meio caminho dele, e
 * desenhar com `bendPointOf` como controle daria metade da barriga pedida. A
 * alça que a pessoa arrasta é `bendPointOf`; quem faz a curva encostar nela é
 * este.
 *
 * A garantia vale para **todo** valor aceito pelo banco, inclusive `0` e `1`:
 * as duas funções leem o `bendT` pela mesma trava (`drawableBendT`), então a
 * curva passa pela alça também nos extremos — é a alça que para um pouco
 * antes da ponta, não a curva que foge dela.
 *
 * Com `bendOffset` nulo ou zero o controle cai no meio da reta, e a
 * quadrática degenera na reta de sempre.
 */
export function bendControlOf(
  segment: Segment,
  bendT: number | null,
  bendOffset: number | null
): Point {
  const t = drawableBendT(bendT);
  const bend = bendPointOf(segment, bendT, bendOffset);

  // Inverte B(t) = (1-t)²·P0 + 2(1-t)t·C + t²·P2 para C.
  const inverse = 1 - t;
  const weight = 2 * inverse * t;

  return {
    x:
      (bend.x - inverse * inverse * segment.from.x - t * t * segment.to.x) /
      weight,
    y:
      (bend.y - inverse * inverse * segment.from.y - t * t * segment.to.y) /
      weight,
  };
}

/**
 * O caminho inverso: um ponto na tela vira `(bendT, bendOffset)`.
 *
 * ## Assinatura
 *
 * ```ts
 * bendFromPoint(segment: Segment, point: Point): { bendT: number; bendOffset: number }
 * ```
 *
 * - `segment` — de novo o traço que está sendo desenhado, o mesmo que foi
 *   dado a `bendPointOf`.
 * - `point` — onde o ponteiro está, já convertido para o espaço da lousa
 *   (descontados o enquadramento e o zoom). É o que sai do arraste da alça.
 * - Devolve o par pronto para o `PATCH`, preso ao que dá para desenhar:
 *   `bendT` em `BEND_T_MIN..BEND_T_MAX` e `bendOffset` em
 *   `±MAX_BEND_OFFSET`. Os dois cabem folgados nos limites do Zod da rota e
 *   do CHECK do banco, então nenhum arraste consegue montar um corpo que
 *   volte 400.
 *
 * É o inverso exato de `bendPointOf` dentro da faixa desenhável: alimentar o
 * resultado de volta nela devolve o mesmo ponto. Os dois valores andam sempre
 * juntos, porque o banco exige os dois ou nenhum
 * (`(bend_t IS NULL) = (bend_offset IS NULL)`).
 */
export function bendFromPoint(
  segment: Segment,
  point: Point
): { bendT: number; bendOffset: number } {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const span = Math.hypot(dx, dy);

  if (span === 0) return { bendT: 0.5, bendOffset: 0 };

  const ux = dx / span;
  const uy = dy / span;
  const px = point.x - segment.from.x;
  const py = point.y - segment.from.y;

  return {
    // A projeção sobre a direção do traço, em fração do comprimento.
    bendT: drawableBendT((px * ux + py * uy) / span),
    // E sobre a perpendicular — o mesmo giro de 90° de `bendPointOf`.
    bendOffset: drawableBendOffset(px * -uy + py * ux),
  };
}
