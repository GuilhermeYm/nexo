"use client";

import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { Plus } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// Acordeão no padrão OriginUI/shadcn sobre o Radix — teclado, aria-expanded e
// aria-controls vêm de graça. O gatilho usa um "+" que gira 45° e vira "×"
// quando aberto, em vez do chevron padrão.

export function Accordion({
  ...props
}: ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

export function AccordionItem({
  className,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn(
        "border-b border-border/70 last:border-b-0",
        className
      )}
      {...props}
    />
  );
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group flex flex-1 items-start justify-between gap-4 rounded-lg py-5 text-left text-base font-semibold text-foreground outline-none sm:text-lg",
          className
        )}
        {...props}
      >
        {children}
        {/* O hover acende, não apaga: o rótulo continua em foreground e quem
            reage é o sinal de abrir, que ganha fundo e cor. Antes o título
            desbotava ao passar o mouse — a afordância ao contrário. */}
        <span className="-my-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-transparent transition-colors duration-200 group-hover:bg-tertiary">
          <Plus
            aria-hidden="true"
            className="size-5 text-subtle-foreground transition-[transform,color] duration-300 ease-out group-hover:text-foreground group-data-[state=open]:rotate-[135deg] group-data-[state=open]:text-foreground motion-reduce:transition-none"
          />
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
      {...props}
    >
      <div
        className={cn(
          "pb-6 pr-10 text-sm leading-relaxed text-muted-foreground sm:text-base",
          className
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Content>
  );
}
