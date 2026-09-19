"use client";

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

const GAP = 6;
const MARGIN = 8;

/**
 * Um painel que abre ancorado a um botão, no `body`, com posição `fixed`.
 *
 * A barra de formatação rola na horizontal (`overflow-x-auto`), e um painel
 * `absolute` dentro dela era recortado pela própria barra — `overflow-x`
 * rolável força o eixo vertical a recortar também. Fora dela, no `body`, o
 * painel fica inteiro, e é empurrado de volta para dentro da tela quando o
 * botão está perto da borda.
 *
 * Fecha no Esc (devolvendo o foco ao botão), ao clicar fora e quando a página
 * rola — ancorado a um ponto que saiu do lugar, ele ficaria solto no ar.
 */
export function FloatingPanel({
  anchorRef,
  open,
  onClose,
  align = "start",
  label,
  className,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  align?: "start" | "end";
  /** O nome do painel para leitores de tela. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <FloatingPanelBody
      anchorRef={anchorRef}
      onClose={onClose}
      align={align}
      label={label}
      className={className}
    >
      {children}
    </FloatingPanelBody>
  );
}

/** Monta a cada abertura: a posição sempre é medida de novo, do zero. */
function FloatingPanelBody({
  anchorRef,
  onClose,
  align,
  label,
  className,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  align: "start" | "end";
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!anchor || !panel) return;

    const wanted = align === "end" ? anchor.right - panel.width : anchor.left;
    const left = Math.min(
      Math.max(MARGIN, wanted),
      window.innerWidth - panel.width - MARGIN
    );
    const below = anchor.bottom + GAP;
    const top =
      below + panel.height > window.innerHeight - MARGIN
        ? Math.max(MARGIN, anchor.top - GAP - panel.height)
        : below;
    setPosition({ top, left });
  }, [align, anchorRef]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      anchorRef.current?.focus();
    }
    function onScroll(event: Event) {
      if (panelRef.current?.contains(event.target as Node)) return;
      onClose();
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, anchorRef]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        // Medido antes de aparecer: a primeira pintura calcula o lugar.
        visibility: position ? "visible" : "hidden",
      }}
      className={cn(
        "fixed z-50 rounded-xl border border-border bg-background shadow-[0_8px_24px_-12px_rgb(0_0_0/0.25)] print:hidden",
        className
      )}
    >
      {children}
    </div>,
    document.body
  );
}
