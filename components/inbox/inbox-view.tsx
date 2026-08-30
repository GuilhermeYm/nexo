"use client";

import { ArrowLeft, Inbox, MailOpen } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/dashboard/panel";
import {
  NotificationItem,
  type InboxNotification,
} from "@/components/inbox/notification-item";

interface InboxViewProps {
  initial: InboxNotification[];
  initialUnreadCount: number;
}

/**
 * A Entrada — centro de notificações do usuário.
 *
 * Mostra mensagens do sistema (Nexo) e, no futuro, mensagens de outros
 * usuários. A classificação `type` já vem do banco; a UI só a pinta
 * diferente. O estado de lido/não lida é otimista: a tela responde antes da
 * rota confirmar.
 */
export function InboxView({ initial, initialUnreadCount }: InboxViewProps) {
  const [notifications, setNotifications] = useState(initial);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [now, setNow] = useState(() => Date.now());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const handleToggleRead = useCallback(
    async (id: string, nextRead: boolean) => {
      const previous = notifications.find((item) => item.id === id);
      if (!previous || pendingIds.has(id)) return;

      setPendingIds((current) => new Set(current).add(id));
      setError(null);

      // Otimismo: muda na hora.
      setNotifications((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, read: nextRead, readAt: nextRead ? new Date() : null }
            : item
        )
      );
      setUnreadCount((current) =>
        nextRead ? Math.max(0, current - 1) : current + 1
      );

      try {
        const response = await fetch(`/api/notifications/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ read: nextRead }),
        });

        if (!response.ok) {
          // Volta ao estado anterior se o servidor recusou.
          setNotifications((current) =>
            current.map((item) =>
              item.id === id ? { ...item, read: previous.read } : item
            )
          );
          setUnreadCount((current) =>
            previous.read ? current + 1 : Math.max(0, current - 1)
          );
          setError("Não foi possível atualizar a notificação.");
        }
      } catch {
        setNotifications((current) =>
          current.map((item) =>
            item.id === id ? { ...item, read: previous.read } : item
          )
        );
        setUnreadCount((current) =>
          previous.read ? current + 1 : Math.max(0, current - 1)
        );
        setError("Sem conexão. A notificação não foi atualizada.");
      } finally {
        setPendingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [notifications, pendingIds]
  );

  const handleMarkAllRead = useCallback(async () => {
    if (unreadCount === 0) return;

    const previous = notifications;
    setNotifications((current) =>
      current.map((item) =>
        !item.read ? { ...item, read: true, readAt: new Date() } : item
      )
    );
    setUnreadCount(0);
    setError(null);

    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "PATCH",
      });

      if (!response.ok) {
        setNotifications(previous);
        setUnreadCount(
          previous.filter((item) => !item.read).length
        );
        setError("Não foi possível marcar todas como lidas.");
      }
    } catch {
      setNotifications(previous);
      setUnreadCount(previous.filter((item) => !item.read).length);
      setError("Sem conexão. As notificações continuam não lidas.");
    }
  }, [notifications, unreadCount]);

  return (
    // A mesma "janela" de Tags e Configurações: moldura arredondada sobre o
    // fundo. A Entrada era a única das três telas de `/dashboard` sem ela — e
    // sem o caminho de volta, o que a deixava sendo uma sala sem porta: quem
    // chegava aqui só saía pelo botão do navegador.
    <div className="flex min-h-dvh bg-secondary p-3">
      <main className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-background">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-10 sm:py-14">
          <Link
            href="/dashboard"
            className="flex w-fit items-center gap-1.5 rounded-lg py-1 pr-2 text-sm text-subtle-foreground transition-colors duration-150 hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Início
          </Link>

          <div className="mt-6 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-xl bg-accent text-sm font-bold text-accent-foreground font-[family-name:var(--font-display)]"
            >
              n.
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
              Entrada
            </h1>
          </div>

          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
            Notificações da Nexo e, em breve, mensagens de outros usuários.
          </p>

          {error && (
            <p className="mt-4 text-sm text-error" role="alert">
              {error}
            </p>
          )}

          {/* Sem fundo próprio: a moldura já está sobre `bg-background`, e as
              linhas não lidas se destacam com `bg-secondary/40`. Um fundo aqui
              apagaria essa distinção. Mesmo desenho das listas de Tags. */}
          <section className="mt-7 flex flex-col overflow-hidden rounded-2xl border border-border">
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-2.5">
                <h2 className="text-sm font-semibold text-foreground">Todas</h2>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {unreadCount}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={unreadCount === 0}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <MailOpen className="size-3.5" aria-hidden="true" />
                Marcar todas como lidas
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="size-5" aria-hidden="true" />}
                  title="Nada na entrada"
                  description="Quando houver notificações da Nexo ou de outros usuários, elas aparecerão aqui."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      now={now}
                      onToggleRead={handleToggleRead}
                      disabled={pendingIds.has(notification.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
