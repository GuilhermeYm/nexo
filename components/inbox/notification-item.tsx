"use client";

import { Bell, User } from "lucide-react";

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
}

interface NotificationItemProps {
  notification: InboxNotification;
  now: number;
  onToggleRead: (id: string, read: boolean) => void;
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
  disabled,
}: NotificationItemProps) {
  const isSystem = notification.type === "system";
  const Icon = isSystem ? Bell : User;

  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onToggleRead(notification.id, !notification.read)}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150",
          notification.read
            ? "hover:bg-secondary/40"
            : "bg-secondary/40 hover:bg-secondary/70"
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
    </li>
  );
}
