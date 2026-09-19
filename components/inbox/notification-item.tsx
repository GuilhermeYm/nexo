"use client";

import { ArrowUpRight, Bell, LoaderCircle, Sparkles, User } from "lucide-react";
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
  type: "system" | "user";
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

/**
 * O que o servidor pôs no `metadata` e esta linha sabe desenhar. Qualquer
 * outra coisa é ignorada — a linha nunca quebra por um formato novo.
 */
function readMetadata(metadata: unknown): {
  href: string | null;
  action: NotificationAction | null;
  actionTakenAt: string | null;
} {
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
  return { href, action, actionTakenAt };
}

interface NotificationItemProps {
  notification: InboxNotification;
  now: number;
  onToggleRead: (id: string, read: boolean) => void;
  /** A ação da notificação deu certo: a lista a marca como lida e resolvida. */
  onActionTaken?: (id: string) => void;
  disabled?: boolean;
}

/**
 * Uma linha de notificação na Entrada.
 *
 * O item inteiro é clicável: tocar alterna entre lido e não lida. Isso dá um
 * alvo grande o suficiente para dedo e mouse, e não exige um botão "×"
 * pequeno. Notificações não lidas ganham destaque sutil; lidas ficam em cinza.
 */
export function NotificationItem({
  notification,
  now,
  onToggleRead,
  onActionTaken,
  disabled,
}: NotificationItemProps) {
  const isSystem = notification.type === "system";
  const Icon = isSystem ? Bell : User;
  const { href, action, actionTakenAt } = readMetadata(notification.metadata);
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

  return (
    // O fundo de "não lida" é da linha inteira, não só do botão: com a faixa
    // de ação embaixo, o aviso não pode parecer partido em dois.
    <li className={cn(!notification.read && "bg-secondary/40")}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onToggleRead(notification.id, !notification.read)}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150",
          "hover:bg-secondary/40"
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
            isSystem
              ? "bg-tag-4/50 text-tag-4-foreground"
              : "bg-tag-2/50 text-tag-2-foreground"
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>

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
            <p
              className={cn(
                "mt-0.5 line-clamp-2 text-sm leading-relaxed",
                notification.read
                  ? "text-subtle-foreground"
                  : "text-muted-foreground"
              )}
            >
              {notification.body}
            </p>
          )}

          <p className="mt-1.5 text-[11px] text-subtle-foreground">
            {notification.read ? "Lida" : "Não lida"}
          </p>
        </div>
      </button>

      {/* Fora do botão de lida/não lida: botão dentro de botão não é HTML
          válido, e tocar na ação não pode também alternar a leitura. */}
      {(action || href) && (
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
              className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground pointer-coarse:h-10"
            >
              Abrir a nota
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
