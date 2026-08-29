/**
 * Visual sem animação. Nem todo card precisa se mexer — se todos se movessem
 * ao mesmo tempo a seção viraria um carrossel e nada se destacaria.
 */

const SECURITY_POINTS = [
  "Row Level Security em todas as tabelas",
  "Arquivos em buckets privados",
  "Trilha de auditoria em cada alteração",
];

export function SecurityVisual() {
  return (
    <ul className="flex w-full flex-col gap-2">
      {SECURITY_POINTS.map((point) => (
        <li
          key={point}
          className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-tag-3-foreground" />
          {point}
        </li>
      ))}
    </ul>
  );
}
