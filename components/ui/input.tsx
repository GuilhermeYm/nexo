import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// Campo de texto no padrão visual do projeto (ver button.tsx).
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "flex h-11 w-full rounded-xl border border-border bg-transparent px-4 text-sm text-foreground transition-colors duration-200 placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
