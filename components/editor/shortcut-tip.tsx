"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { ariaKeyshortcuts, type Shortcut } from "@/lib/editor/shortcuts";
import { cn } from "@/lib/utils";

/**
 * A dica de um botão da barra: o que ele faz, e a tecla que faz o mesmo.
 *
 * Antes era o `title` do navegador — uma linha cinza que demora um segundo
 * para aparecer, some sozinha, não sai no teclado e desenha `⌘⇧H` como texto
 * corrido. Aqui a ação vem em palavra e cada tecla vem numa cápsula `kbd`,
 * que é como se lê um atalho sem parar para decifrar.
 *
 * Vai para o `body` com posição `fixed` pelo mesmo motivo do `FloatingPanel`:
 * a barra rola na horizontal e recortaria qualquer coisa `absolute` dentro
 * dela; o bubble menu já vive fora da árvore do editor.
 *
 * **Só no mouse.** No toque, o dedo cobre o botão e não existe "passar por
 * cima"; no teclado ela aparece na hora, sem espera, porque quem chegou pelo
 * Tab está justamente procurando o que é aquele botão.
 */

const GAP = 8;
const MARGIN = 8;
/** Tempo até a dica aparecer: curto o bastante para servir, longo o bastante
 * para não piscar quando o ponteiro só atravessa a barra. */
const DELAY_MS = 350;

/**
 * Os atributos que todo botão com atalho carrega, dica à parte.
 *
 * Sem `title`: o navegador desenharia a dica dele por cima da nossa, e a
 * pessoa veria a mesma coisa escrita de dois jeitos ao mesmo tempo.
 */
export function shortcutProps(shortcut: Shortcut) {
  return { "aria-keyshortcuts": ariaKeyshortcuts(shortcut) };
}

/**
 * O estado da dica: quando abrir, quando sumir, e o que pendurar no botão.
 *
 * O `ref` do botão fica com quem chama, não aqui: um ref devolvido dentro de
 * um objeto é lido a cada render pelo `react-hooks/refs`, e o mesmo botão
 * costuma ancorar também um painel.
 */
export function useShortcutTip<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const hide = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
  }, []);

  useEffect(() => hide, [hide]);

  const handlers = {
    onPointerEnter: (event: React.PointerEvent<T>) => {
      if (event.pointerType !== "mouse") return;
      timer.current = window.setTimeout(() => setOpen(true), DELAY_MS);
    },
    onPointerLeave: hide,
    // Clicou: a dica já cumpriu o papel, e ficar sobre um botão que mudou de
    // estado só atrapalha.
    onPointerDown: hide,
    onFocus: (event: React.FocusEvent<T>) => {
      if (event.currentTarget.matches(":focus-visible")) setOpen(true);
    },
    onBlur: hide,
  };

  return { open, hide, handlers };
}

/**
 * As teclas em cápsulas. `---` é o que se digita, então vai sem cápsula — e
 * um controle sem atalho (a cor, a fonte) passa `keys: []` e mostra só o nome.
 */
export function Keycaps({
  shortcut,
  className,
}: {
  shortcut: Shortcut;
  className?: string;
}) {
  if (shortcut.keys.length === 0) return null;
  if (shortcut.kind === "typed") {
    return (
      <span
        className={cn(
          "font-mono text-[11px] text-subtle-foreground",
          className
        )}
      >
        {shortcut.keys.join(" ")}
      </span>
    );
  }
  return (
    <span className={cn("flex items-center gap-0.5", className)}>
      {shortcut.keys.map((key) => (
        <kbd
          key={key}
          className="flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-secondary px-1 text-[10px] font-medium leading-none text-subtle-foreground"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutTip({
  anchorRef,
  open,
  onClose,
  shortcut,
  placement = "bottom",
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  shortcut: Shortcut;
  placement?: "top" | "bottom";
}) {
  if (!open) return null;
  return (
    <ShortcutTipBody
      anchorRef={anchorRef}
      onClose={onClose}
      shortcut={shortcut}
      placement={placement}
    />
  );
}

/** Monta a cada abertura: a posição sempre é medida de novo, do zero. */
function ShortcutTipBody({
  anchorRef,
  onClose,
  shortcut,
  placement,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  shortcut: Shortcut;
  placement: "top" | "bottom";
}) {
  const tipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const tip = tipRef.current?.getBoundingClientRect();
    if (!anchor || !tip) return;

    const left = Math.min(
      Math.max(MARGIN, anchor.left + anchor.width / 2 - tip.width / 2),
      window.innerWidth - tip.width - MARGIN
    );
    const above = anchor.top - GAP - tip.height;
    const below = anchor.bottom + GAP;
    // A preferência vira do avesso quando o lado escolhido não cabe.
    const top =
      placement === "top"
        ? above < MARGIN
          ? below
          : above
        : below + tip.height > window.innerHeight - MARGIN
          ? Math.max(MARGIN, above)
          : below;
    setPosition({ top, left });
  }, [anchorRef, placement]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      // O botão já diz o que é (rótulo) e qual a tecla (`aria-keyshortcuts`):
      // para o leitor de tela esta camada seria a terceira repetição.
      aria-hidden="true"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        // Medida antes de aparecer: a primeira pintura calcula o lugar.
        visibility: position ? "visible" : "hidden",
      }}
      className="pointer-events-none fixed z-[60] flex items-center gap-2 rounded-lg border border-border bg-background py-1 pl-2.5 pr-1.5 text-xs text-foreground shadow-[0_8px_24px_-12px_rgb(0_0_0/0.25)] print:hidden"
    >
      <span className="whitespace-nowrap">{shortcut.label}</span>
      <Keycaps shortcut={shortcut} />
    </div>,
    document.body
  );
}
