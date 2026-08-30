"use client";

import {
  createContext,
  useContext,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/**
 * Abas — no formato de API do OriginUI/shadcn (`Tabs` / `TabsList` /
 * `TabsTrigger` / `TabsContent`), mas sem o `@radix-ui/react-tabs` por trás.
 *
 * Duas abas numa página de configurações não justificam uma dependência nova,
 * e o padrão ARIA de abas é curto o bastante para escrever à mão: `tablist`
 * com tabindex rotativo, setas para navegar, `Home`/`End` para as pontas, e
 * cada `tabpanel` ligado ao seu `tab` por `aria-controls`/`aria-labelledby`.
 * É a mesma escolha que a seção de planos já fez com o seletor de período.
 *
 * Ativação automática: mover o foco troca a aba. Os painéis aqui são baratos
 * de montar, então não há motivo para exigir um segundo gesto.
 */

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error(`<${component}> precisa estar dentro de <Tabs>.`);
  }
  return context;
}

export function Tabs({
  value,
  onValueChange,
  className,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const baseId = useId();

  return (
    <TabsContext.Provider value={{ value, onValueChange, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  children,
  "aria-label": ariaLabel,
}: {
  className?: string;
  children: ReactNode;
  "aria-label": string;
}) {
  const { value, onValueChange } = useTabs("TabsList");
  const listRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;

    const triggers = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        "[role='tab']:not([disabled])"
      ) ?? []
    );
    if (triggers.length === 0) return;

    const currentIndex = triggers.findIndex(
      (trigger) => trigger.dataset.value === value
    );

    let nextIndex = currentIndex;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + triggers.length) % triggers.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % triggers.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = triggers.length - 1;
    }

    event.preventDefault();
    const next = triggers[nextIndex];
    next.focus();
    onValueChange(next.dataset.value ?? value);
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex items-stretch gap-1 border-b border-border",
        className
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  disabled,
  className,
  children,
}: {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { value: active, onValueChange, baseId } = useTabs("TabsTrigger");
  const selected = active === value;

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      data-value={value}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => onValueChange(value)}
      className={cn(
        "relative -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium",
        "transition-colors duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset",
        "disabled:pointer-events-none disabled:opacity-50",
        selected
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
        // Alvo confortável para o dedo, sem inflar no desktop.
        "pointer-coarse:py-3.5",
        className
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const { value: active, baseId } = useTabs("TabsContent");
  if (active !== value) return null;

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      tabIndex={0}
      className={cn("outline-none focus-visible:ring-0", className)}
    >
      {children}
    </div>
  );
}
