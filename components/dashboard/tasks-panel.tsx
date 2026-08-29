"use client";

import {
  CircleAlert,
  CircleCheck,
  Coins,
  LoaderCircle,
  Sparkles,
  Tags,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";

import { EmptyState, Panel } from "@/components/dashboard/panel";
import { useLiveResource } from "@/hooks/use-live-resource";
import { formatAbsolute, formatRelative, toIsoString } from "@/lib/dashboard/format";
import type { AiJobItem } from "@/lib/dashboard/queries";
import { cn } from "@/lib/utils";

/** Tabelas cuja mudança invalida este painel. Constante no módulo para o
 *  hook não reassinar o canal a cada render. */
const TABLES = ["ai_jobs"] as const;

const KIND_ICON: Record<string, LucideIcon> = {
  classify: WandSparkles,
  summarize: Sparkles,
  tag: Tags,
  transcribe: Sparkles,
  extract: Sparkles,
  organize: WandSparkles,
};

interface StatusStyle {
  icon: LucideIcon;
  /** Cor do ícone. Só os estados que pedem atenção saem do cinza. */
  tone: string;
  label: string;
  spin?: boolean;
}

const STATUS: Record<string, StatusStyle> = {
  queued: { icon: LoaderCircle, tone: "text-subtle-foreground", label: "Na fila" },
  running: {
    icon: LoaderCircle,
    tone: "text-tag-4-foreground",
    label: "Em andamento",
    spin: true,
  },
  succeeded: {
    icon: CircleCheck,
    tone: "text-tag-3-foreground",
    label: "Concluída",
  },
  failed: { icon: CircleAlert, tone: "text-error", label: "Falhou" },
  insufficient_credits: {
    icon: Coins,
    tone: "text-tag-1-foreground",
    label: "Sem créditos",
  },
};

/**
 * "Tarefas" — o que os agentes fizeram com as capturas.
 *
 * As pendentes por falta de crédito sobem para o topo (a ordenação é do
 * servidor) e recebem a única superfície destacada do painel, porque são as
 * únicas linhas que pedem uma decisão. O resto é histórico e se comporta
 * como histórico: legível, discreto, sem competir.
 */
export function TasksPanel({
  initial,
  renderedAt,
  now,
  registerRefresh,
}: {
  initial: AiJobItem[];
  renderedAt: number;
  now: number;
  /** Entrega o revalidador ao shell, para um upload recém-concluído aparecer
   *  aqui na hora, sem esperar o evento do Realtime dar a volta. */
  registerRefresh?: (refresh: () => void) => void;
}) {
  const { items, status, isRefreshing, refresh } = useLiveResource<AiJobItem>({
    endpoint: "/api/jobs",
    field: "jobs",
    initial,
    tables: [...TABLES],
  });

  useEffect(() => {
    registerRefresh?.(refresh);
  }, [registerRefresh, refresh]);

  const pending = items.filter(
    (job) => job.status === "insufficient_credits"
  ).length;

  return (
    <Panel
      title="Tarefas"
      count={pending}
      status={status}
      isRefreshing={isRefreshing}
    >
      {items.length === 0 ? (
        <EmptyState
          icon={<WandSparkles className="size-5" aria-hidden="true" />}
          title="Nenhuma tarefa ainda"
          description="Envie um arquivo pela barra acima. Cada coisa que a Nexo ler, classificar ou marcar aparece aqui, com o que ela decidiu."
        />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((job) => {
            const state = STATUS[job.status] ?? STATUS.queued;
            const StatusIcon = state.icon;
            const KindIcon = KIND_ICON[job.kind] ?? WandSparkles;
            const isPending = job.status === "insufficient_credits";
            const timestamp = job.finishedAt ?? job.createdAt;

            return (
              <li
                key={job.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3.5 transition-colors duration-150",
                  isPending ? "bg-secondary/60" : "hover:bg-secondary/40"
                )}
              >
                <span className={cn("mt-0.5 shrink-0", state.tone)}>
                  <StatusIcon
                    className={cn(
                      "size-4",
                      state.spin && "animate-spin motion-reduce:animate-none"
                    )}
                    aria-hidden="true"
                  />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {job.label}
                    </p>
                    <time
                      dateTime={toIsoString(timestamp)}
                      title={formatAbsolute(timestamp)}
                      suppressHydrationWarning
                      className="shrink-0 text-xs tabular-nums text-subtle-foreground"
                    >
                      {formatRelative(timestamp, now || renderedAt)}
                    </time>
                  </div>

                  {job.detail && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {job.detail}
                    </p>
                  )}

                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] text-subtle-foreground">
                      <KindIcon className="size-3" aria-hidden="true" />
                      {state.label}
                    </span>

                    {isPending && (
                      <button
                        type="button"
                        disabled
                        title="Disponível quando a assinatura estiver ativa"
                        className="cursor-not-allowed rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground opacity-70"
                      >
                        Retomar
                        {job.creditsCost > 0 && ` · ${job.creditsCost} créditos`}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
