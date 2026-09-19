"use client";

import {
  ArrowUpRight,
  Bell,
  Check,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  formatAbsolute,
  formatRelative,
  toIsoString,
} from "@/lib/dashboard/format";
import { cn } from "@/lib/utils";

export interface InboxNotification {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: Date;
  /** Escrito só pelo servidor (0011). Pode trazer um link e uma ação. */
  metadata?: unknown;
}

interface NotificationAction {
  type: "ai-extra-reads";
  label: string;
}

interface ReadMetadata {
  href: string | null;
  action: NotificationAction | null;
  actionTakenAt: string | null;
  /** Aviso de fim de tarefa (0031): `succeeded` ou `failed`. */
  jobStatus: "succeeded" | "failed" | null;
  /** A falha que uma nova tentativa resolveu depois (0031). */
  resolvedAt: string | null;
}

/**
 * O que o servidor pôs no `metadata` e esta linha sabe desenhar. Qualquer
 * outra coisa é ignorada — a linha nunca quebra por um formato novo.
 */
function readMetadata(metadata: unknown): ReadMetadata {
  const value = (metadata && typeof metadata === "object" ? metadata : {}) as Record<
    string,
    unknown
  >;
  // Só caminho interno: um `href` absoluto não vira link, nem vindo do servidor.
  const href =
    typeof value.href === "string" && value.href.startsWith("/") && !value.href.startsWith("//")
      ? value.href
      : null;
  const raw = value.action as Record<string, unknown> | undefined;
  const action =
    raw && raw.type === "ai-extra-reads"
      ? { type: "ai-extra-reads" as const, label: String(raw.label ?? "Ler mesmo assim") }
      : null;
  const actionTakenAt = typeof value.actionTakenAt === "string" ? value.actionTakenAt : null;
  const jobStatus =
    value.kind === "job" && (value.status === "succeeded" || value.status === "failed")
      ? value.status
      : null;
  const resolvedAt = typeof value.resolvedAt === "string" ? value.resolvedAt : null;
  return { href, action, actionTakenAt, jobStatus, resolvedAt };
}

const TONES: Record<"system" | "succeeded" | "failed", { icon: LucideIcon; className: string }> = {
  system: { icon: Bell, className: "bg-tag-4/50 text-tag-4-foreground" },
  succeeded: { icon: CircleCheck, className: "bg-tag-3/50 text-tag-3-foreground" },
  failed: { icon: CircleAlert, className: "bg-error/10 text-error" },
};

interface NotificationItemProps {
  notification: InboxNotification;
  now: number;
  onToggleRead: (id: string, read: boolean) => void;
  /** A ação da notificação deu certo: a lista a marca como lida e resolvida. */
  onActionTaken?: (id: string) => void;
  disabled?: boolean;
  /** Selecionando: tocar a linha marca a caixa, não a leitura. */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelected?: (id: string) => void;
}

/**
 * Uma linha de notificação na Entrada.
 *
 * O item inteiro é clicável: tocar alterna entre lido e não lida. Isso dá um
 * alvo grande o suficiente para dedo e mouse, e não exige um botão "×"
 * pequeno. No modo de seleção a linha inteira vira o rótulo da caixa — o
 * mesmo desenho dos cartões de Arquivos.
 */
export function NotificationItem({
  notification,
  now,
  onToggleRead,
  onActionTaken,
  disabled,
  selectionMode = false,
  selected = false,
  onToggleSelected,
}: NotificationItemProps) {
  const { href, action, actionTakenAt, jobStatus, resolvedAt } = readMetadata(
    notification.metadata
  );
  const tone = TONES[resolvedAt ? "succeeded" : (jobStatus ?? "system")];
  const Icon = tone.icon;
  const [phase, setPhase] = useState<"idle" | "busy" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function runAction() {
    if (phase === "busy") return;
    setPhase("busy");
    setMessage(null);
    try {
      const response = await fetch("/api/ai/extra-reads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: notification.id }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        setPhase("error");
        setMessage(body?.error ?? "Não foi possível liberar as leituras.");
        return;
      }
      setPhase("idle");
      onActionTaken?.(notification.id);
    } catch {
      setPhase("error");
      setMessage("Sem conexão. Tente de novo.");
    }
  }

  const content = (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline gap-2">
        <p
          className={cn(
            "min-w-0 flex-1 text-sm",
            notification.read
              ? "font-normal text-muted-foreground"
              : "font-medium text-foreground"
          )}
        >
          {notification.title}
        </p>
        <time
          dateTime={toIsoString(notification.createdAt)}
          title={formatAbsolute(notification.createdAt)}
          suppressHydrationWarning
          className="shrink-0 text-xs tabular-nums text-subtle-foreground"
        >
          {formatRelative(notification.createdAt, now)}
        </time>
      </div>

      {notification.body && (
        // `pre-line`: o aviso de tarefa (0031) traz o rótulo e o detalhe em
        // duas linhas.
        <p
          className={cn(
            "mt-0.5 line-clamp-3 text-sm leading-relaxed whitespace-pre-line",
            notification.read
              ? "text-subtle-foreground"
              : "text-muted-foreground"
          )}
        >
          {notification.body}
        </p>
      )}

      <p className="mt-1.5 text-[11px] text-subtle-foreground">
        {resolvedAt
          ? "Resolvida depois — a nova tentativa deu certo"
          : notification.read
            ? "Lida"
            : "Não lida"}
      </p>
    </div>
  );

  // Ação e link ficam fora do botão da linha: botão dentro de botão não é
  // HTML válido, e tocar na ação não pode também alternar a leitura. Na
  // seleção eles somem — a linha inteira é da caixa.
  const showFooter = !selectionMode && (action || href);

  return (
    // O fundo de "não lida" é da linha inteira, não só do botão: com a faixa
    // de ação embaixo, o aviso não pode parecer partido em dois.
    <li
      className={cn(
        !notification.read && "bg-secondary/40",
        selectionMode && selected && "bg-tertiary"
      )}
    >
      {selectionMode ? (
        <label className="flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-secondary/40">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected?.(notification.id)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40"
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-md border transition-colors",
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-subtle-foreground/60 bg-background"
              )}
            >
              {selected && <Check className="size-3.5" strokeWidth={3} />}
            </span>
          </span>
          {content}
        </label>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onToggleRead(notification.id, !notification.read)}
          className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-secondary/40"
        >
          <span
            className={cn(
              "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
              tone.className
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
          </span>
          {content}
        </button>
      )}

      {showFooter && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3.5 pl-[3.75rem]">
          {action &&
            (actionTakenAt ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-subtle-foreground">
                <Sparkles className="size-3" aria-hidden="true" />
                Leituras liberadas
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void runAction()}
                disabled={phase === "busy"}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-semibold text-accent-foreground transition-colors duration-150 hover:bg-accent/90 disabled:opacity-70 pointer-coarse:h-10"
              >
                {phase === "busy" ? (
                  <LoaderCircle
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <Sparkles className="size-3.5" aria-hidden="true" />
                )}
                {action.label}
              </button>
            ))}
          {href && (
            <Link
              href={href}
              // Ir ver é ler: quem abre o detalhe não volta para marcar à mão.
              onClick={() => {
                if (!notification.read) onToggleRead(notification.id, true);
              }}
              className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground pointer-coarse:h-10"
            >
              {jobStatus ? "Ver em Tarefas" : "Abrir a nota"}
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
          {message && (
            <span role="alert" className="w-full text-xs text-error">
              {message}
            </span>
          )}
        </div>
      )}
    </li>
  );
}
