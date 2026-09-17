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
 * "Tarefas" porque o painel ao lado já tem esse nome (docs/AGENDA.md).
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
  }, [today]);

  const done = lines?.filter((line) => line.checked).length ?? 0;

  return (
    <section
      aria-labelledby="today-tasks-title"
      className="mt-12 overflow-hidden rounded-2xl border border-border bg-background"
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
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Não foi possível carregar as tarefas de hoje.
        </p>
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
        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
          {lines.map((line, index) => (
            <li
              key={index}
              className="flex items-start gap-3 py-2.5 pr-4"
              style={{ paddingLeft: `${1 + line.depth * 1.5}rem` }}
            >
              {line.checked ? (
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-accent bg-accent text-accent-foreground"
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
              ) : (
                <Link
                  href="/dashboard/agenda"
                  aria-label={`Abrir a Agenda para concluir: ${line.text}`}
                  title="Concluir na Agenda"
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-border text-transparent transition-[background-color,border-color,transform] duration-150 hover:border-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 motion-reduce:active:scale-100"
                >
                  <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                </Link>
              )}
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
