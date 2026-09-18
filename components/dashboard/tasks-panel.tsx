"use client";

import {
  CircleAlert,
  CircleCheck,
  Coins,
  LoaderCircle,
  Maximize2,
  Pin,
  Sparkles,
  Tags,
  Trash2,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, Panel, QuietFooter } from "@/components/dashboard/panel";
import { TasksFullscreen } from "@/components/dashboard/tasks-fullscreen";
import { ErrorReport } from "@/components/errors/error-report";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useLiveResource } from "@/hooks/use-live-resource";
import { useNewItems } from "@/hooks/use-new-items";
import {
  formatAbsolute,
  formatRelative,
  STALE_AFTER_MS,
  toIsoString,
} from "@/lib/dashboard/format";
import { isPinnedJob } from "@/lib/dashboard/pinned-jobs";
import type { AiJobItem } from "@/lib/dashboard/queries";
import { readApiFailure } from "@/lib/api-failure";
import { cn } from "@/lib/utils";

/** Tabelas cuja mudança invalida este painel. Constante no módulo para o
 *  hook não reassinar o canal a cada render. */
const TABLES = ["ai_jobs"] as const;

const jobId = (job: AiJobItem) => job.id;

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
  waiting_configuration: {
    icon: CircleAlert,
    tone: "text-tag-1-foreground",
    label: "Aguardando IA",
  },
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

/** Data da última atividade da lista, para decidir se o painel anda quieto. */
function lastActivity(jobs: AiJobItem[]): number {
  return jobs.reduce((newest, job) => {
    const stamp = new Date(job.finishedAt ?? job.createdAt).getTime();
    return stamp > newest ? stamp : newest;
  }, 0);
}

/**
 * "Tarefas" — o que os agentes fizeram com as capturas.
 *
 * As tarefas paradas por falta de crédito são **fixadas**: saem numa faixa
 * própria no topo, com a única superfície destacada do painel, porque são as
 * únicas linhas que pedem uma decisão (assinar para retomar). A ordenação e o
 * corte vêm do servidor — `listAiJobs` nunca deixa uma fixada cair da lista.
 * O resto é histórico e se comporta como histórico: legível, discreto, sem
 * competir.
 */
export function TasksPanel({
  initial,
  renderedAt,
  now,
  registerRefresh,
  onUpload,
}: {
  initial: AiJobItem[];
  renderedAt: number;
  now: number;
  /** Entrega o revalidador ao shell, para um upload recém-concluído aparecer
   *  aqui na hora, sem esperar o evento do Realtime dar a volta. */
  registerRefresh?: (refresh: () => void) => void;
  /** Abre o seletor de arquivo da barra de comando. */
  onUpload?: () => void;
}) {
  const { items, status, isRefreshing, refresh } = useLiveResource<AiJobItem>({
    endpoint: "/api/jobs",
    field: "jobs",
    initial,
    tables: [...TABLES],
  });

  // A resposta do DELETE é suficiente para tirar a linha da tela. A rebusca
  // continua acontecendo em seguida para preencher o espaço com o próximo
  // item do histórico, mas uma queda de rede nesse segundo request não pode
  // ressuscitar visualmente uma tarefa que o servidor já excluiu.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState(false);
  const visibleItems = items.filter((job) => !deletedIds.has(job.id));

  const handleDeleted = useCallback(
    async function handleDeleted(id: string) {
      setDeletedIds((current) => new Set(current).add(id));
      await refresh();
    },
    [refresh]
  );

  const fresh = useNewItems(visibleItems, jobId);

  useEffect(() => {
    registerRefresh?.(refresh);
  }, [registerRefresh, refresh]);

  const pinned = visibleItems.filter(isPinnedJob);
  const history = visibleItems.filter((job) => !isPinnedJob(job));

  const clock = now || renderedAt;
  const quiet =
    pinned.length === 0 &&
    history.length > 0 &&
    lastActivity(history) < clock - STALE_AFTER_MS;

  return (
    <>
    <Panel
      title="Tarefas"
      count={pinned.length}
      status={status}
      isRefreshing={isRefreshing}
      action={
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title="Tela cheia — o histórico inteiro, com o detalhe de cada tarefa"
          className="-mr-1.5 flex size-8 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground pointer-coarse:size-11"
        >
          <Maximize2 className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Abrir Tarefas em tela cheia</span>
        </button>
      }
    >
      {visibleItems.length === 0 ? (
        <EmptyState
          icon={<WandSparkles className="size-5" aria-hidden="true" />}
          title="Nenhuma tarefa ainda"
          description="Envie um arquivo pela barra acima. Cada coisa que a Nexo ler, classificar ou marcar aparece aqui, com o que ela decidiu."
          action={
            onUpload
              ? { label: "Enviar um arquivo", onClick: onUpload }
              : undefined
          }
        />
      ) : (
        <div className="flex min-h-full flex-col">
          {pinned.length > 0 && (
            <div className="border-b border-border bg-tag-1/60">
              <h3 className="flex items-center gap-1.5 px-4 pt-3 pb-1.5 text-xs font-semibold text-muted-foreground">
                <Pin className="size-3 text-tag-1-foreground" aria-hidden="true" />
                Fixado até acontecer
              </h3>
              <ul className="divide-y divide-tag-1-foreground/10">
                {pinned.map((job, index) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    now={clock}
                    isNew={fresh.has(job.id)}
                    entranceIndex={index}
                    pinned
                  />
                ))}
              </ul>
            </div>
          )}

          {history.length > 0 && (
            <ul className="divide-y divide-border">
              {history.map((job, index) => (
                <JobRow
                  key={job.id}
                  job={job}
                  now={clock}
                  isNew={fresh.has(job.id)}
                  entranceIndex={pinned.length + index}
                  onDeleted={handleDeleted}
                />
              ))}
            </ul>
          )}

          {quiet && (
            <QuietFooter
              label="Sem tarefas novas por aqui há um tempo."
              actionLabel={onUpload ? "Enviar um arquivo" : undefined}
              onAction={onUpload}
            />
          )}
        </div>
      )}
    </Panel>

    <TasksFullscreen
      open={expanded}
      onClose={() => setExpanded(false)}
      pinned={pinned}
      live={items}
      now={clock}
    />
    </>
  );
}

/**
 * Uma linha do feed de Tarefas.
 *
 * `pinned` tira o fundo próprio da linha — quem carrega a cor é a faixa em
 * volta — e deixa só o realce de hover. `isNew` dispara a animação de entrada
 * e a lavagem de cor que recua, e ela só chega em linha que entrou de fato
 * depois do primeiro render (ver `useNewItems`).
 */
function JobRow({
  job,
  now,
  isNew,
  entranceIndex,
  pinned,
  onDeleted,
}: {
  job: AiJobItem;
  now: number;
  isNew: boolean;
  entranceIndex: number;
  pinned?: boolean;
  onDeleted?: (id: string) => void | Promise<void>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<{
    message: string;
    code: string | null;
  } | null>(null);
  const state = STATUS[job.status] ?? STATUS.queued;
  const StatusIcon = state.icon;
  const KindIcon = KIND_ICON[job.kind] ?? WandSparkles;
  const timestamp = job.finishedAt ?? job.createdAt;

  async function deleteFailedJob() {
    if (deleting || job.status !== "failed") return;

    setDeleting(true);
    setDeleteFailure(null);

    try {
      const response = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });

      if (!response.ok) {
        const failure = await readApiFailure(
          response,
          "Não foi possível excluir esta falha."
        );
        setDeleteFailure({ message: failure.message, code: failure.code });
        return;
      }

      await onDeleted?.(job.id);
    } catch {
      setDeleteFailure({
        message: "Erro de conexão. Tente novamente.",
        code: null,
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <li
      data-row-enter={isNew ? "" : undefined}
      data-dashboard-enter={isNew ? undefined : ""}
      className={cn(
        "relative flex items-start gap-3 px-4 py-3.5 transition-colors duration-150",
        isNew && "animate-row-in motion-reduce:animate-none",
        !isNew && "animate-dashboard-enter motion-reduce:animate-none",
        pinned ? "hover:bg-tag-1-foreground/5" : "hover:bg-secondary/40"
      )}
      style={
        isNew
          ? undefined
          : { animationDelay: `${Math.min(entranceIndex, 6) * 40 + 310}ms` }
      }
    >
      {isNew && (
        <span
          aria-hidden="true"
          data-row-flash=""
          className="pointer-events-none absolute inset-0 animate-row-flash bg-accent/10 motion-reduce:hidden"
        />
      )}

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
            {formatRelative(timestamp, now)}
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

          {pinned && job.status === "insufficient_credits" && (
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

          {job.status === "failed" && (
            <button
              type="button"
              onClick={() => {
                setDeleteFailure(null);
                setConfirmingDelete(true);
              }}
              className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-subtle-foreground transition-colors hover:bg-error/10 hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={`Excluir tarefa que falhou: ${job.label}`}
            >
              <Trash2 className="size-3" aria-hidden="true" />
              Excluir
            </button>
          )}
        </div>

        <ConfirmDialog
          open={job.status === "failed" && confirmingDelete}
          title="Excluir tarefa do histórico?"
          subject={job.label}
          description={
            <>
              A tarefa falha e o relatório técnico ligado a ela serão removidos.
              A nota e o arquivo continuam guardados.
            </>
          }
          confirmLabel="Excluir tarefa"
          busyLabel="Excluindo…"
          busy={deleting}
          error={
            deleteFailure ? (
              <>
                <span>{deleteFailure.message}</span>
                {deleteFailure.code && (
                  <ErrorReport
                    code={deleteFailure.code}
                    route={`/api/jobs/${job.id}`}
                    compact
                  />
                )}
              </>
            ) : undefined
          }
          onOpenChange={(open) => {
            setConfirmingDelete(open);
            if (!open) setDeleteFailure(null);
          }}
          onConfirm={() => void deleteFailedJob()}
        />
      </div>
    </li>
  );
}
