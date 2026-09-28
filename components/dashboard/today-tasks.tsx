"use client";

import { Check, ListTodo } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { EmptyState, RowSkeleton } from "@/components/dashboard/panel";
import { useLocalDay } from "@/hooks/use-local-day";
import { listTaskLines, type TaskLine } from "@/lib/editor/document";
import { cn } from "@/lib/utils";

/**
 * "Agenda de hoje" — as caixas da lista do dia, no dashboard. Não se chama
 * "Tarefas" para não disputar nome com a Atividade da Nexo, o painel que
 * registra o que a IA fez (docs/AGENDA.md).
 *
 * Todo o estado nasce no cliente: "hoje" é o dia do relógio de quem olha, e o
 * servidor não sabe o fuso do navegador (ver docs/AGENDA.md). Por isso não
 * há `initial` vindo da página, e o primeiro render é um esqueleto.
 *
 * Só leitura. Marcar a caixa é editar o documento, e isso fica na Agenda —
 * dois editores do mesmo dia abertos ao mesmo tempo sobrescreveriam um ao
 * outro no `PATCH`.
 */
export function TodayTasks() {
  const router = useRouter();
  const today = useLocalDay();
  const [lines, setLines] = useState<TaskLine[] | null>(null);
  const [failed, setFailed] = useState(false);
  // "Tentar de novo" só incrementa: o efeito abaixo roda outra vez.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!today) return;
    let controller: AbortController | null = null;

    async function load(day: string) {
      controller?.abort();
      const current = new AbortController();
      controller = current;

      try {
        const response = await fetch(`/api/agenda/${day}`, {
          signal: current.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          setFailed(true);
          return;
        }
        const body = (await response.json()) as {
          note: { contentRich: unknown } | null;
        };
        setFailed(false);
        setLines(body.note ? listTaskLines(body.note.contentRich) : []);
      } catch {
        // Abort ou rede fora: fica o último estado bom.
      }
    }

    void load(today);

    // Voltar para a aba é quando a lista mais provavelmente mudou: a pessoa
    // estava na Agenda, ou em outro aparelho.
    function onVisible() {
      if (document.visibilityState === "visible" && today) void load(today);
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      controller?.abort();
    };
  }, [today, attempt]);

  const done = lines?.filter((line) => line.checked).length ?? 0;

  return (
    <section
      aria-labelledby="today-tasks-title"
      className="mt-10 overflow-hidden rounded-2xl border border-border bg-background"
    >
      <header className="flex h-12 items-center gap-2.5 border-b border-border px-4">
        <h2
          id="today-tasks-title"
          className="text-sm font-semibold text-foreground"
        >
          Agenda de hoje
        </h2>
        {lines && lines.length > 0 && (
          <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {done} de {lines.length}
          </span>
        )}
        {lines && lines.length > 0 && (
          <Link
            href="/dashboard/agenda"
            className="ml-auto rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground pointer-coarse:py-1.5"
          >
            Abrir a Agenda
          </Link>
        )}
      </header>

      {failed && lines === null ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-5">
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar as tarefas de hoje.
          </p>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setAttempt((current) => current + 1);
            }}
            className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-secondary pointer-coarse:py-2"
          >
            Tentar de novo
          </button>
        </div>
      ) : lines === null || !today ? (
        <RowSkeleton rows={3} />
      ) : lines.length === 0 ? (
        <EmptyState
          icon={<ListTodo className="size-5" aria-hidden="true" />}
          title="Nenhuma tarefa para hoje"
          description="Você ainda não colocou nada como tarefa hoje. O que precisa acontecer?"
          action={{
            label: "Escrever a lista de hoje",
            onClick: () => router.push("/dashboard/agenda"),
          }}
        />
      ) : (
        // A linha inteira leva à Agenda, e a caixa é só desenho. Antes a
        // caixa de 16px era um link com cara de checkbox: quem clicava para
        // marcar ia parar em outra página, e o dedo mal acertava o alvo.
        // Marcar continua sendo coisa da Agenda (ver o topo do arquivo).
        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
          {lines.map((line, index) => (
            <li
              key={index}
              data-dashboard-enter=""
              className="animate-dashboard-enter motion-reduce:animate-none"
              style={{ animationDelay: `${Math.min(index, 5) * 40}ms` }}
            >
              <Link
                href="/dashboard/agenda"
                title={line.checked ? undefined : "Concluir na Agenda"}
                className="flex items-start gap-3 py-2.5 pr-4 transition-colors duration-150 hover:bg-secondary/40 pointer-coarse:py-3"
                style={{ paddingLeft: `${1 + line.depth * 1.5}rem` }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                    line.checked
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border"
                  )}
                >
                  {line.checked && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 text-sm leading-snug break-words",
                    line.checked
                      ? "text-subtle-foreground line-through"
                      : "text-foreground"
                  )}
                >
                  <span className="sr-only">
                    {line.checked ? "Concluída: " : "Pendente: "}
                  </span>
                  {line.text}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
