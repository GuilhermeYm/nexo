"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";

import type {
  AiPreferences,
  LimitNotice,
  ReasoningEffort,
} from "@/lib/ai/preference-options";
import { cn } from "@/lib/utils";

export interface AiModelInfo {
  provider: string;
  model: string;
  /** O modelo pensa antes de responder — só aí a primeira escolha vale. */
  reasoning: boolean;
}

const EFFORT_OPTIONS: { value: ReasoningEffort; label: string; hint: string }[] = [
  {
    value: "low",
    label: "Econômico",
    hint: "Pensa o mínimo. Resumo e tags iguais, com cerca de 70% menos tokens de saída e três vezes mais rápido.",
  },
  {
    value: "medium",
    label: "Equilibrado",
    hint: "Pensa um pouco mais antes de responder. Custa mais, e em notas pessoais raramente muda o resultado.",
  },
  {
    value: "high",
    label: "Cuidadoso",
    hint: "Pensa bastante. Só compensa em textos longos e ambíguos — é o mais caro e o mais lento.",
  },
];

const NOTICE_OPTIONS: { value: LimitNotice; label: string; hint: string }[] = [
  {
    value: "immediate",
    label: "Na hora",
    hint: "Um aviso na Entrada assim que uma nota chega ao limite, com o botão “Ler mesmo assim”.",
  },
  {
    value: "daily",
    label: "Resumo do dia",
    hint: "Um aviso só, às 23 h, com todas as notas que chegaram ao limite naquele dia.",
  },
  {
    value: "off",
    label: "Não avisar",
    hint: "A nota espera o dia seguinte em silêncio.",
  },
];

/**
 * Configurações → IA.
 *
 * Ao contrário das Preferências, estas escolhas são **da conta**: quem as lê
 * é o servidor, na hora de chamar o modelo. Gravam na hora, uma a uma, por
 * `PATCH /api/account/ai`.
 */
export function AiPanel({
  initial,
  model,
  dailyReads,
}: {
  initial: AiPreferences;
  model: AiModelInfo | null;
  /** O teto de leituras por nota por dia, para o texto não mentir. */
  dailyReads: number;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [saving, setSaving] = useState<keyof AiPreferences | null>(null);
  const [saved, setSaved] = useState<keyof AiPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save<K extends keyof AiPreferences>(key: K, value: AiPreferences[K]) {
    if (prefs[key] === value) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    setSaving(key);
    setSaved(null);
    setError(null);
    try {
      const response = await fetch("/api/account/ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setSaved(key);
    } catch {
      setPrefs(previous);
      setError("Não salvou. Tente de novo.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Como a Nexo lê as suas notas e arquivos. Estas escolhas são da conta —
        valem em qualquer aparelho.
      </p>

      <ChoiceSection
        title="Quanto a IA pensa antes de responder"
        description="Modelos como o desta instância raciocinam antes de responder, e esse raciocínio é cobrado como resposta — sem nunca aparecer para você."
        options={EFFORT_OPTIONS}
        value={prefs.reasoningEffort}
        recommended="low"
        onChange={(value) => void save("reasoningEffort", value)}
        status={saving === "reasoningEffort" ? "saving" : saved === "reasoningEffort" ? "saved" : null}
        footer={
          model ? (
            model.reasoning ? (
              <>
                Modelo desta instância: <span className="font-mono">{model.provider} · {model.model}</span>.
              </>
            ) : (
              <>
                O modelo desta instância (<span className="font-mono">{model.model}</span>) não
                raciocina antes de responder. A escolha fica guardada e passa a valer se a
                instância trocar para um modelo que raciocina.
              </>
            )
          ) : (
            "Esta instância ainda não tem chave de IA configurada."
          )
        }
      />

      <ChoiceSection
        title="Quando uma nota chega ao limite de leituras"
        description={`A Nexo relê uma nota no máximo ${dailyReads} vezes por dia, para uma nota editada o dia todo não virar dezenas de chamadas. Quando esse limite chega:`}
        options={NOTICE_OPTIONS}
        value={prefs.limitNotice}
        recommended="immediate"
        onChange={(value) => void save("limitNotice", value)}
        status={saving === "limitNotice" ? "saving" : saved === "limitNotice" ? "saved" : null}
        footer="“Ler mesmo assim” libera mais 3 leituras daquela nota, só naquele dia."
      />

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}

function ChoiceSection<T extends string>({
  title,
  description,
  options,
  value,
  recommended,
  onChange,
  status,
  footer,
}: {
  title: string;
  description: string;
  options: { value: T; label: string; hint: string }[];
  value: T;
  recommended: T;
  onChange: (value: T) => void;
  status: "saving" | "saved" | null;
  footer: React.ReactNode;
}) {
  const name = useId();

  return (
    <fieldset className="rounded-2xl border border-border bg-secondary/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <legend className="float-left text-sm font-medium text-foreground">{title}</legend>
        <span role="status" className="flex h-5 shrink-0 items-center gap-1 text-xs text-subtle-foreground">
          {status === "saving" && (
            <>
              <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Salvando
            </>
          )}
          {status === "saved" && (
            <>
              <Check className="size-3" aria-hidden="true" />
              Salvo
            </>
          )}
        </span>
      </div>
      <p className="clear-both mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>

      <div className="mt-4 space-y-2">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                checked
                  ? "border-foreground/30 bg-background"
                  : "border-border hover:bg-background/60"
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  checked ? "border-accent bg-accent" : "border-subtle-foreground/60 bg-background"
                )}
              >
                {checked && <span className="size-1.5 rounded-full bg-accent-foreground" />}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {option.label}
                  {option.value === recommended && (
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      recomendado
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">
                  {option.hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-subtle-foreground">
        {footer}
      </p>
    </fieldset>
  );
}
