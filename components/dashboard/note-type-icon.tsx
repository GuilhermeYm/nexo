import {
  FileText,
  ListTodo,
  NotebookPen,
  PenLine,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Um ícone por `note_type` do schema. Um só lugar decide o desenho de cada
 * tipo, então a lista de Recentes, a busca e qualquer painel futuro falam a
 * mesma língua visual.
 */
const BY_TYPE: Record<string, LucideIcon> = {
  note: FileText,
  task: ListTodo,
  journal: NotebookPen,
  idea: Sparkles,
  meeting: Users,
  document: PenLine,
};

export function NoteTypeIcon({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const Icon = BY_TYPE[type] ?? FileText;
  return <Icon className={className} aria-hidden="true" />;
}

/** Rótulo em pt-BR do tipo, para leitores de tela e para a lista. */
export const NOTE_TYPE_LABEL: Record<string, string> = {
  note: "Nota",
  task: "Tarefa",
  journal: "Diário",
  idea: "Ideia",
  meeting: "Reunião",
  document: "Documento",
};
