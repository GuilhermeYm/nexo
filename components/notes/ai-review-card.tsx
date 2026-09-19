"use client";

import { Check, LoaderCircle, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * "A Nexo pode pôr a casa em ordem" — o cartão que **pergunta** antes de
 * reler resumos e organizar pastas (`POST /api/ai/review`).
 *
 * Nada disso roda sozinho, por dois motivos: reescrever resumo é a parte cara
 * da leitura (por isso a releitura automática às vezes só marca), e criar
 * pasta sem ninguém pedir entulha a conta. Então a IA junta o que há para
 * fazer e a pessoa decide.
 *
 * "Agora não" guarda, **neste aparelho**, as contagens daquele momento: o
 * cartão só volta quando houver mais coisa do que havia (`docs/NAVEGADOR.md`).
 */

const DISMISS_KEY = "nexo-ai-review-dismissed";
/** Com menos que isto sem pasta, organizar não vale o cartão. */
const MIN_UNFILED = 3;
const POLL_MS = 4000;
const POLL_LIMIT_MS = 120_000;

interface ReviewCounts {
  configured: boolean;
  staleSummaries: number;
  unfiled: number;
  organizing: boolean;
}

function readDismissed(): { stale: number; unfiled: number } | null {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { stale?: unknown; unfiled?: unknown };
    return typeof value.stale === "number" && typeof value.unfiled === "number"
      ? { stale: value.stale, unfiled: value.unfiled }
      : null;
  } catch {
    return null;
  }
}

function writeDismissed(value: { stale: number; unfiled: number } | null) {
  try {
    if (value) window.localStorage.setItem(DISMISS_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(DISMISS_KEY);
  } catch {
    // Sem armazenamento, o cartão só volta a aparecer na próxima visita.
  }
}

async function fetchCounts(signal?: AbortSignal): Promise<ReviewCounts | null> {
  try {
    const response = await fetch("/api/ai/review", { signal });
    if (!response.ok) return null;
    return (await response.json()) as ReviewCounts;
  } catch {
    return null;
  }
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function AiReviewCard({
  refreshKey,
  forceOpen,
  onForceClose,
  onDone,
  onVisibleChange,
}: {
  /** Muda quando a lista muda (nota movida, pasta apagada): recontar. */
  refreshKey: number;
  /** A pessoa pediu pelo botão "Reler e organizar", mesmo tendo dispensado. */
  forceOpen: boolean;
  onForceClose: () => void;
  /** A Nexo terminou: recarregar a lista e as pastas. */
  onDone: () => void;
  /** O cartão está na tela? Quem chama esconde o atalho duplicado. */
  onVisibleChange: (visible: boolean) => void;
}) {
  const titleId = useId();
  const [counts, setCounts] = useState<ReviewCounts | null>(null);
  const [dismissed, setDismissed] = useState<{ stale: number; unfiled: number } | null>(null);
  const [summaries, setSummaries] = useState(true);
  const [folders, setFolders] = useState(true);
  const [phase, setPhase] = useState<
    "idle" | "sending" | "working" | "done" | "slow" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);
  // O que foi pedido — o texto de "Pronto" fala só disso.
  const [requested, setRequested] = useState({ summaries: false, folders: false });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const next = await fetchCounts(controller.signal);
      if (controller.signal.aborted) return;
      setDismissed(readDismissed());
      if (next) setCounts(next);
    })();
    return () => controller.abort();
  }, [refreshKey]);

  // Enquanto a Nexo trabalha, confere de tempos em tempos se acabou.
  useEffect(() => {
    if (phase !== "working") return;
    const startedAt = Date.now();
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        const next = await fetchCounts();
        if (cancelled || !next) return;
        const finished = !next.organizing && next.staleSummaries === 0;
        const tooLong = Date.now() - startedAt > POLL_LIMIT_MS;
        if (finished || tooLong) {
          window.clearInterval(timer);
          setCounts(next);
          // A mensagem de "trabalhando" sai; "Pronto" fala do resultado.
          setMessage(null);
          setPhase(finished ? "done" : "slow");
          onDone();
        }
      })();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [phase, onDone]);

  const staleCount = counts?.staleSummaries ?? 0;
  const unfiledCount = counts?.unfiled ?? 0;
  const hasStale = staleCount > 0;
  const hasUnfiled = unfiledCount > 0;
  const worthAsking = hasStale || unfiledCount >= MIN_UNFILED;
  const grewSinceDismissed =
    !dismissed || staleCount > dismissed.stale || unfiledCount > dismissed.unfiled;

  const busy = phase === "sending" || phase === "working";
  const visible =
    Boolean(counts?.configured) &&
    (phase !== "idle" || forceOpen || (worthAsking && grewSinceDismissed));

  useEffect(() => {
    onVisibleChange(visible);
  }, [visible, onVisibleChange]);

  // Uma região viva só, sempre montada: o leitor de tela ouve cada troca.
  const doneText =
    message ??
    [
      requested.summaries ? "Os resumos foram reescritos." : null,
      requested.folders
        ? unfiledCount > 0
          ? `As pastas foram organizadas; ${plural(unfiledCount, "nota não combinou", "notas não combinaram")} com nenhuma e ${unfiledCount === 1 ? "ficou" : "ficaram"} sem pasta.`
          : "As pastas foram organizadas."
        : null,
      "O detalhe fica em Tarefas.",
    ]
      .filter(Boolean)
      .join(" ");
  const statusText =
    phase === "sending"
      ? "Pedindo à Nexo…"
      : phase === "working"
        ? message
        : phase === "done"
          ? doneText
          : phase === "slow"
            ? "Ainda em andamento. A lista foi atualizada com o que já terminou; o resto aparece em Tarefas."
            : "";

  if (!visible || !counts) {
    return (
      <p aria-live="polite" className="sr-only">
        {statusText}
      </p>
    );
  }

  const wantSummaries = hasStale && summaries;
  const wantFolders = hasUnfiled && folders;

  function dismiss() {
    const snapshot = { stale: staleCount, unfiled: unfiledCount };
    writeDismissed(snapshot);
    setDismissed(snapshot);
    setPhase("idle");
    setMessage(null);
    onForceClose();
  }

  async function run() {
    setPhase("sending");
    setMessage(null);
    setRequested({ summaries: wantSummaries, folders: wantFolders });
    try {
      const response = await fetch("/api/ai/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summaries: wantSummaries, folders: wantFolders }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        summaries?: number;
        organizing?: boolean;
      };
      if (!response.ok) {
        setMessage(body.error ?? "Não deu para pedir agora. Tente de novo em instantes.");
        setPhase("error");
        return;
      }
      writeDismissed(null);
      const parts = [
        body.summaries ? `relendo ${plural(body.summaries, "resumo", "resumos")}` : null,
        body.organizing ? "organizando as pastas" : null,
      ].filter(Boolean);
      setMessage(
        parts.length
          ? `A Nexo está ${parts.join(" e ")}. Pode continuar usando — a lista atualiza quando terminar.`
          : "Nada para fazer agora: outra organização já está em andamento."
      );
      setPhase(parts.length ? "working" : "done");
    } catch {
      setMessage("Sem conexão. Confira a rede e tente de novo.");
      setPhase("error");
    }
  }

  const summary = [
    hasStale
      ? `${plural(staleCount, "resumo ficou", "resumos ficaram")} de uma versão anterior da nota`
      : null,
    hasUnfiled ? `${plural(unfiledCount, "nota está", "notas estão")} sem pasta` : null,
  ].filter(Boolean);

  return (
    <section
      aria-labelledby={titleId}
      className="mt-8 animate-row-in rounded-2xl border border-border bg-secondary/50 px-4 py-4 motion-reduce:animate-none sm:px-5"
    >
      <p aria-live="polite" className="sr-only">
        {statusText}
      </p>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 hidden size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent sm:flex">
          <Sparkles className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            {phase === "done" ? "Pronto" : phase === "slow" ? "Quase lá" : "Reler e organizar com a Nexo?"}
          </h2>

          {phase === "idle" || phase === "error" ? (
            <>
              <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-pretty text-muted-foreground">
                {summary.length
                  ? `${summary.join(", e ")}.`
                  : "Está tudo em dia — nenhum resumo velho e nenhuma nota sem pasta."}
              </p>

              {summary.length > 0 && (
                <fieldset className="mt-3 space-y-0.5">
                  <legend className="sr-only">O que a Nexo deve fazer</legend>
                  {hasStale && (
                    <Choice
                      checked={summaries}
                      onChange={setSummaries}
                      label="Reler os resumos desatualizados"
                      hint="Uma leitura por nota, até 20 por vez."
                    />
                  )}
                  {hasUnfiled && (
                    <Choice
                      checked={folders}
                      onChange={setFolders}
                      label="Organizar as notas em pastas"
                      hint="Reusa suas pastas; as notas que você já pôs numa pasta ficam onde estão."
                    />
                  )}
                </fieldset>
              )}

              {phase === "error" && message && (
                <p role="alert" className="mt-3 text-sm text-error">
                  {message}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {summary.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void run()}
                    disabled={!wantSummaries && !wantFolders}
                    className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-3.5 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-45 pointer-coarse:h-11"
                  >
                    Fazer agora
                  </button>
                )}
                <button
                  type="button"
                  onClick={dismiss}
                  className="h-9 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:h-11"
                >
                  {summary.length ? "Agora não" : "Fechar"}
                </button>
              </div>
            </>
          ) : (
            <div>
              <p aria-hidden="true" className="mt-1 flex max-w-[62ch] items-start gap-2 text-sm leading-relaxed text-pretty text-muted-foreground">
                {busy && (
                  <LoaderCircle
                    className="mt-0.5 size-4 shrink-0 animate-spin text-accent motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                )}
                {statusText}
              </p>
              {phase === "working" && (
                <Link
                  href="/dashboard"
                  className="mt-3 inline-flex h-9 items-center rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:h-11"
                >
                  Acompanhar em Tarefas
                </Link>
              )}
            </div>
          )}
        </div>

        {!busy && (
          <button
            type="button"
            // Fecha como "Agora não": o que sobrou (nota que não combinou com
            // pasta nenhuma) não reabre o cartão na hora.
            onClick={dismiss}
            className="flex size-8 shrink-0 pointer-coarse:size-11 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Dispensar</span>
          </button>
        )}
      </div>
    </section>
  );
}

function Choice({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="-mx-2 flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-background/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40",
          checked
            ? "border-accent bg-accent text-accent-foreground"
            : "border-muted-foreground/60 bg-background"
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-pretty text-muted-foreground">
          {hint}
        </span>
      </span>
    </label>
  );
}
