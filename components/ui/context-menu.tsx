"use client";

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight } from "lucide-react";
import { useState, type ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Menu de contexto no padrão OriginUI/shadcn sobre o Radix.
 *
 * Trocado por Radix depois de uma primeira versão feita à mão, e a troca
 * paga por si: submenu, navegação por setas, busca por digitação, foco
 * preso dentro do menu, posicionamento que evita sair da tela e **toque
 * longo** vêm prontos. O toque longo importa aqui — sem ele o botão direito
 * seria um recurso só de desktop, o que contradiz o compromisso de
 * multiplataforma do produto.
 *
 * O gesto de arrastar convive com o toque longo porque o Radix cancela a
 * contagem assim que o ponteiro se move: arrastar a lousa não abre menu.
 */

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuSub = ContextMenuPrimitive.Sub;

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      {/* A largura cede ao espaço do lado em que o menu abriu. O Radix vira
          o menu para a esquerda do ponteiro, mas só o desloca no eixo
          vertical: no celular, um toque longo no meio de uma linha deixava
          o `min-w-56` mais a dica do "Excluir" sem caber em nenhum dos lados,
          e o menu nascia cortado na borda esquerda. */}
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        collisionPadding={8}
        className={cn(
          "z-50 min-w-[min(14rem,var(--radix-context-menu-content-available-width))] max-w-(--radix-context-menu-content-available-width) origin-(--radix-context-menu-content-transform-origin) overflow-hidden rounded-xl border border-border bg-background p-1 shadow-[0_16px_48px_-16px] shadow-black/35",
          "data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out",
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        data-slot="context-menu-sub-content"
        className={cn(
          "z-50 max-h-72 min-w-52 origin-(--radix-context-menu-content-transform-origin) overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-[0_16px_48px_-16px] shadow-black/35",
          "data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out",
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

const itemClasses =
  "flex w-full cursor-default items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40";

export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.SubTrigger>) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      className={cn(
        itemClasses,
        "items-center text-foreground data-[highlighted]:bg-tertiary data-[state=open]:bg-tertiary",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRight
        aria-hidden="true"
        className="ml-auto size-4 shrink-0 text-subtle-foreground"
      />
    </ContextMenuPrimitive.SubTrigger>
  );
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function ContextMenuLabel({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      className={cn(
        "px-2.5 pt-2 pb-1.5 text-[11px] font-bold tracking-wide text-subtle-foreground uppercase",
        className
      )}
      {...props}
    />
  );
}

interface ContextMenuItemProps extends Omit<
  ComponentProps<typeof ContextMenuPrimitive.Item>,
  "onSelect"
> {
  /** Ação destrutiva: pinta em vermelho e passa a exigir dois cliques. */
  destructive?: boolean;
  /** Rótulo do segundo clique. Padrão: "Confirmar". */
  confirmLabel?: string;
  onSelect?: () => void;
}

/**
 * Um item do menu.
 *
 * Item destrutivo confirma **dentro do próprio menu**: o primeiro clique
 * troca o rótulo, o segundo executa. Um diálogo modal interromperia uma ação
 * que não precisa de interrupção; um clique único apagaria conteúdo sem rede
 * de proteção. O estado de "armado" morre junto com o menu, porque o Radix
 * desmonta o conteúdo ao fechar — reabrir sempre começa desarmado.
 */
export function ContextMenuItem({
  className,
  children,
  destructive,
  confirmLabel = "Confirmar",
  onSelect,
  ...props
}: ContextMenuItemProps) {
  const [armed, setArmed] = useState(false);

  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      onSelect={(event) => {
        if (destructive && !armed) {
          // Segura o menu aberto para o segundo clique acontecer nele.
          event.preventDefault();
          setArmed(true);
          return;
        }
        onSelect?.();
      }}
      className={cn(
        itemClasses,
        destructive
          ? "text-error data-[highlighted]:bg-error/10"
          : "text-foreground data-[highlighted]:bg-tertiary",
        className
      )}
      {...props}
    >
      {armed ? (
        <>
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1 font-semibold">{confirmLabel}</span>
        </>
      ) : (
        <span className="flex min-w-0 flex-1 items-start gap-2.5">
          {children}
        </span>
      )}
    </ContextMenuPrimitive.Item>
  );
}

/** Rótulo com explicação, para usar dentro de um item. */
export function ContextMenuItemLabel({
  label,
  hint,
}: {
  label: string;
  hint?: string;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block font-medium">{label}</span>
      {hint && (
        <span className="mt-0.5 block text-xs leading-snug text-subtle-foreground">
          {hint}
        </span>
      )}
    </span>
  );
}
