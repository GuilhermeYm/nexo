import {
  CalendarDays,
  FileText,
  House,
  Inbox,
  Paperclip,
  Tags,
  type LucideIcon,
} from "lucide-react";

export interface DashboardNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Rotas futuras continuam visíveis no trilho, mas não entram no seletor. */
  ready?: boolean;
}

/** Mesma ordem no trilho e no seletor de páginas. */
export const DASHBOARD_NAV_ITEMS: DashboardNavItem[] = [
  { label: "Início", href: "/dashboard", icon: House, ready: true },
  { label: "Entrada", href: "/dashboard/entrada", icon: Inbox, ready: true },
  { label: "Agenda", href: "/dashboard/agenda", icon: CalendarDays, ready: true },
  { label: "Notas e pastas", href: "/dashboard/notas", icon: FileText, ready: true },
  { label: "Tags", href: "/dashboard/tags", icon: Tags, ready: true },
  { label: "Arquivos", href: "/dashboard/arquivos", icon: Paperclip, ready: true },
];
