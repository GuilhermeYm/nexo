import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Combina classes condicionais (clsx) e resolve conflitos do Tailwind (twMerge).
// Usado por todos os componentes de UI (padrão OriginUI/shadcn).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
