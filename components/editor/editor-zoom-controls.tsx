"use client";

import { Minus, Plus } from "lucide-react";
import { type ReactNode } from "react";

import {
  DEFAULT_EDITOR_ZOOM,
  MAX_EDITOR_ZOOM,
  MIN_EDITOR_ZOOM,
} from "@/hooks/use-editor-zoom";
import { cn } from "@/lib/utils";

export function EditorZoomControls({
  zoom,
  onDecrease,
  onIncrease,
  onReset,
  className,
}: {
  zoom: number;
  onDecrease: () => void;
  onIncrease: () => void;
  onReset: () => void;
  className?: string;
}) {
  return (
    <div
      aria-label="Zoom do texto"
      className={cn("flex items-center gap-0.5", className)}
    >
      <ZoomButton
        label="Diminuir zoom do texto (Ctrl ou ⌘ -)"
        disabled={zoom <= MIN_EDITOR_ZOOM}
        onClick={onDecrease}
      >
        <Minus className="size-4" aria-hidden="true" />
      </ZoomButton>
      <button
        type="button"
        disabled={zoom === DEFAULT_EDITOR_ZOOM}
        onClick={onReset}
        title="Restaurar zoom do texto (Ctrl ou ⌘ 0)"
        className="flex h-8 min-w-11 items-center justify-center rounded-lg px-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-tertiary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-45 pointer-coarse:h-10"
      >
        {zoom}%
        <span className="sr-only">Zoom atual: {zoom}%</span>
      </button>
      <ZoomButton
        label="Aumentar zoom do texto (Ctrl ou ⌘ +)"
        disabled={zoom >= MAX_EDITOR_ZOOM}
        onClick={onIncrease}
      >
        <Plus className="size-4" aria-hidden="true" />
      </ZoomButton>
    </div>
  );
}

function ZoomButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      className="flex size-8 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-tertiary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-45 pointer-coarse:size-10"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}
