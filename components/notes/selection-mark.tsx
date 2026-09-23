import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A caixa desenhada nos cartões do modo "Apagar" (pastas e Kanban).
 *
 * É só desenho: o estado vai no `aria-pressed` do cartão, que é o controle.
 */
export function SelectionMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 motion-reduce:transition-none",
        checked ? "border-error bg-error text-white dark:text-background" : "border-border bg-background"
      )}
    >
      {checked && <Check className="size-3.5" strokeWidth={3} />}
    </span>
  );
}
