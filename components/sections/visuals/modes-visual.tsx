"use client";

import { Blocks, Sparkles } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A dualidade do Nexo: a IA organiza por padrão, mas o usuário pode assumir o
 * controle e montar tudo à mão, no ambiente de blocos.
 *
 * Este é o único visual clicável da seção — o visitante alterna os dois modos
 * e vê a diferença, em vez de só ler sobre ela.
 */

const MODES = {
  ai: {
    icon: Sparkles,
    label: "IA organiza",
    caption: "Você joga dentro, ela classifica, marca e conecta.",
    rows: [
      { text: "contrato.pdf", tag: "#financeiro", tone: "bg-tag-4 text-tag-4-foreground" },
      { text: "áudio da call", tag: "#reunião", tone: "bg-tag-2 text-tag-2-foreground" },
      { text: "print do gráfico", tag: "#pesquisa", tone: "bg-tag-1 text-tag-1-foreground" },
    ],
  },
  manual: {
    icon: Blocks,
    label: "Você organiza",
    caption: "Blocos, hierarquia e links sob o seu controle.",
    rows: [
      { text: "Projeto solar", tag: "workspace", tone: "bg-tertiary text-muted-foreground" },
      { text: "└ Fornecedores", tag: "sub-nota", tone: "bg-tertiary text-muted-foreground" },
      { text: "└ Orçamentos", tag: "sub-nota", tone: "bg-tertiary text-muted-foreground" },
    ],
  },
} as const;

type ModeKey = keyof typeof MODES;

export function ModesVisual() {
  const [mode, setMode] = useState<ModeKey>("ai");
  const active = MODES[mode];

  return (
    <div className="flex w-full flex-col gap-3">
      {/* Seletor */}
      <div
        role="tablist"
        aria-label="Modo de organização"
        className="flex gap-1 rounded-xl border border-border bg-background p-1"
      >
        {(Object.keys(MODES) as ModeKey[]).map((key) => {
          const { icon: Icon, label } = MODES[key];
          const selected = key === mode;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setMode(key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors duration-200",
                selected
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary"
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-subtle-foreground">{active.caption}</p>

      <ul className="flex flex-col gap-1.5">
        {active.rows.map((row) => (
          <li
            key={row.text}
            className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-2.5 py-1.5"
          >
            <span className="truncate text-xs text-muted-foreground">
              {row.text}
            </span>
            <span
              className={cn(
                "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                row.tone
              )}
            >
              {row.tag}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
