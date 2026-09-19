import type { BoardMark } from "@/lib/workspace/queries";

export type BoardPoint = { x: number; y: number };

/**
 * Amortece o ruído fino de mouse e caneta sem deslocar as pontas do gesto.
 *
 * A janela triangular preserva melhor curvas intencionais que uma média
 * simples. O resultado é persistido (em vez de suavizado só no SVG), então
 * o traço visível e a área acertada pela borracha continuam idênticos.
 */
export function smoothStrokePoints(points: BoardPoint[]): BoardPoint[] {
  if (points.length < 5) return points;

  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;

    const before = points[Math.max(0, index - 2)];
    const previous = points[index - 1];
    const next = points[index + 1];
    const after = points[Math.min(points.length - 1, index + 2)];
    const totalWeight = 9;

    return {
      x: (before.x + previous.x * 2 + point.x * 3 + next.x * 2 + after.x) / totalWeight,
      y: (before.y + previous.y * 2 + point.y * 3 + next.y * 2 + after.y) / totalWeight,
    };
  });
}

/** Descarta pontos subpixel/colineares: menos SVG, JSON e trabalho no Realtime. */
export function simplifyPoints(points: BoardPoint[], tolerance = 1.5): BoardPoint[] {
  if (points.length <= 2) return points;
  const squareTolerance = tolerance * tolerance;
  const radial: BoardPoint[] = [points[0]];
  let previous = points[0];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (distanceSquared(point, previous) >= squareTolerance) {
      radial.push(point);
      previous = point;
    }
  }
  const last = points[points.length - 1];
  if (radial[radial.length - 1] !== last) radial.push(last);
  return radial.length <= 2048 ? radial : radial.filter((_, index) => index % Math.ceil(radial.length / 2048) === 0).slice(0, 2048);
}

export function normalizeStroke(points: BoardPoint[]) {
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.max(1, Math.ceil(maxX - minX)),
    height: Math.max(1, Math.ceil(maxY - minY)),
    points: points.map((point) => ({ x: round2(point.x - minX), y: round2(point.y - minY) })),
  };
}

export function markPath(points: BoardPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

export function markContains(mark: BoardMark, point: BoardPoint, padding: number): boolean {
  if (point.x < mark.x - padding || point.x > mark.x + mark.width + padding || point.y < mark.y - padding || point.y > mark.y + mark.height + padding) return false;
  if (mark.kind !== "pen") return true;
  const local = { x: point.x - mark.x, y: point.y - mark.y };
  for (let index = 1; index < mark.points.length; index += 1) {
    if (segmentDistance(local, mark.points[index - 1], mark.points[index]) <= padding + mark.weight / 2) return true;
  }
  return false;
}

function segmentDistance(point: BoardPoint, a: BoardPoint, b: BoardPoint): number {
  const length = distanceSquared(a, b);
  if (length === 0) return Math.sqrt(distanceSquared(point, a));
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length));
  return Math.hypot(point.x - (a.x + t * (b.x - a.x)), point.y - (a.y + t * (b.y - a.y)));
}

function distanceSquared(a: BoardPoint, b: BoardPoint): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
