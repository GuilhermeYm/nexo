"use client";

import { memo } from "react";

import { markPath, type BoardPoint } from "@/lib/workspace/board-marks";
import type { BoardMark, BoardMarkKind, BoardMarkTone } from "@/lib/workspace/queries";

const STROKE: Record<BoardMarkTone, string> = {
  default: "var(--nx-text-primary)",
  "1": "var(--nx-tag-1-text)",
  "2": "var(--nx-tag-2-text)",
  "3": "var(--nx-tag-3-text)",
  "4": "var(--nx-tag-4-text)",
  "5": "var(--nx-tag-5-text)",
  "6": "var(--nx-tag-6-text)",
};

export interface DraftMark {
  kind: BoardMarkKind;
  points: BoardPoint[];
  start: BoardPoint;
  end: BoardPoint;
  tone: BoardMarkTone;
  weight: number;
}

export const BoardMarksLayer = memo(function BoardMarksLayer({ marks, draft }: { marks: BoardMark[]; draft: DraftMark | null }) {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute overflow-visible" style={{ inset: 0, width: 1, height: 1 }}>
      {marks.map((mark) => <MarkShape key={mark.id} mark={mark} />)}
      {draft && <DraftShape draft={draft} />}
    </svg>
  );
});

const MarkShape = memo(function MarkShape({ mark }: { mark: BoardMark }) {
  const common = { fill: "none", stroke: STROKE[mark.tone], strokeWidth: mark.weight, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, vectorEffect: "non-scaling-stroke" as const };
  if (mark.kind === "pen") return <path d={markPath(mark.points.map((point) => ({ x: point.x + mark.x, y: point.y + mark.y })))} {...common} />;
  return <Geometric kind={mark.kind} x={mark.x} y={mark.y} width={mark.width} height={mark.height} common={common} />;
});

function DraftShape({ draft }: { draft: DraftMark }) {
  const common = { fill: "none", stroke: STROKE[draft.tone], strokeWidth: draft.weight, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, vectorEffect: "non-scaling-stroke" as const };
  if (draft.kind === "pen") return <path d={markPath(draft.points)} {...common} />;
  const x = Math.min(draft.start.x, draft.end.x);
  const y = Math.min(draft.start.y, draft.end.y);
  return <Geometric kind={draft.kind} x={x} y={y} width={Math.abs(draft.end.x - draft.start.x)} height={Math.abs(draft.end.y - draft.start.y)} common={common} />;
}

function Geometric({ kind, x, y, width, height, common }: { kind: Exclude<BoardMarkKind, "pen">; x: number; y: number; width: number; height: number; common: React.SVGProps<SVGElement> }) {
  if (kind === "rectangle") return <rect x={x} y={y} width={width} height={height} rx={4} {...common as React.SVGProps<SVGRectElement>} />;
  if (kind === "ellipse") return <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} {...common as React.SVGProps<SVGEllipseElement>} />;
  return <polygon points={`${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}`} {...common as React.SVGProps<SVGPolygonElement>} />;
}
