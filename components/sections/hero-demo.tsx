import { File, FileText, Lightbulb, Mic } from "lucide-react";

const CAPTURES = [
  { icon: Mic, label: "nota de áudio", meta: "março" },
  { icon: FileText, label: "artigo", meta: "junho" },
  { icon: File, label: "PDF de contrato", meta: null },
];

// Mockup ilustrativo do produto: uma nota "conceito" que a Nexo organiza e
// conecta automaticamente a outras capturas do usuário (áudio, artigo, PDF).
export function HeroDemo() {
  return (
    <div
      data-animate="demo-card"
      className="relative mx-auto grid w-full max-w-4xl grid-cols-1 items-center gap-10 rounded-[28px] border border-border/70 bg-secondary/60 p-6 shadow-2xl shadow-black/[0.06] backdrop-blur-2xl sm:p-8 lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-4 lg:p-10"
    >
      <div
        aria-hidden
        data-animate="glow"
        className="pointer-events-none absolute -left-16 -top-16 size-64 rounded-full bg-tag-1/60 opacity-60 blur-3xl"
      />
      <div
        aria-hidden
        data-animate="glow"
        className="pointer-events-none absolute -bottom-20 -right-10 size-56 rounded-full bg-tag-2/50 opacity-50 blur-3xl"
      />

      <article className="relative flex flex-col gap-4 rounded-3xl border border-border/80 bg-background/80 p-6 shadow-lg shadow-black/[0.04]">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Lightbulb className="size-[22px]" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs font-bold uppercase tracking-wide text-accent">
              Conceito
            </p>
            <p className="truncate text-lg font-semibold text-foreground">
              ideia sobre energia solar…
            </p>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Explorar potencial de geração distribuída e armazenamento para
          edifícios residenciais.
        </p>
      </article>

      <ul className="relative flex flex-col gap-4">
        {CAPTURES.map(({ icon: Icon, label, meta }) => (
          <li
            key={label}
            data-animate="demo-badge"
            className="flex items-center gap-3"
          >
            <span
              aria-hidden
              className="hidden h-px w-10 shrink-0 border-t border-dashed border-subtle-foreground/50 lg:block"
            />
            <span className="flex items-center gap-2.5 rounded-full border border-border/70 bg-background/85 px-4 py-2.5 shadow-sm shadow-black/[0.03]">
              <Icon className="size-[18px] text-accent" />
              <span className="text-sm font-semibold text-foreground">
                {label}
              </span>
              {meta && (
                <span className="rounded-full bg-tag-3 px-2.5 py-1 text-xs font-semibold text-tag-3-foreground">
                  {meta}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
