import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Combina classes condicionais (clsx) e resolve conflitos do Tailwind (twMerge).
// Usado por todos os componentes de UI (padrão OriginUI/shadcn).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Bytes num rótulo curto: "0 B", "180 MB", "1,4 GB", "ilimitado".
 *
 * `null` é "sem limite" (a convenção de `lib/plans.ts`). Uma casa decimal só
 * quando o número é pequeno o bastante para ela dizer algo — "1,4 GB" ajuda,
 * "847,3 MB" é ruído.
 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "ilimitado";
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const rounded =
    value >= 10 || Number.isInteger(value)
      ? Math.round(value)
      : Math.round(value * 10) / 10;

  return `${rounded.toLocaleString("pt-BR")} ${units[unit]}`;
}
