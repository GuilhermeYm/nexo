"use client";

import { ArrowLeft, Inbox, Mail, MailOpen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState } from "@/components/dashboard/panel";
import {
  NotificationItem,
  type InboxNotification,
} from "@/components/inbox/notification-item";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useTableSignal } from "@/hooks/use-table-signal";
import { NOTIFICATIONS_LIMIT } from "@/lib/inbox/limits";
import { cn } from "@/lib/utils";

interface InboxViewProps {
  initial: InboxNotification[];
  initialUnreadCount: number;
}

/**
 * A Entrada — os avisos da Nexo.
 *
 * O que chega aqui: o fim das tarefas da IA (falhas sempre; conclusões,
 * menos a leitura de nota que deu certo — 0031), o limite de leituras, o
 * reset da conta, as boas-vindas e os anúncios de quem administra a
 * instância (`bun run notify`).
 *
 * Lida/não lida é otimista: a tela responde antes da rota confirmar. As
 * ações em lote (marcar, apagar) seguem o desenho da seleção de Arquivos. A
 * lista se mantém viva pelo Realtime: uma tarefa que termina com a Entrada
 * aberta aparece sem recarregar.
 */
export function InboxView({ initial, initialUnreadCount }: InboxViewProps) {
  const [notifications, setNotifications] = useState(initial);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [now, setNow] = useState(() => Date.now());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Uma escrita desta tela em voo: a rebusca do Realtime espera, senão ela
  // traria o estado de antes e desfaria o otimismo na tela.
  const busy = useRef(false);
  useEffect(() => {
    busy.current = bulkBusy || pendingIds.size > 0;
  }, [bulkBusy, pendingIds]);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok || busy.current) return;
      const body = (await response.json()) as {
        notifications: InboxNotification[];
        unreadCount: number;
      };
      setNotifications(body.notifications);
      setUnreadCount(body.unreadCount);
      // O que sumiu (apagado em outro aparelho) sai da seleção também.
      const present = new Set(body.notifications.map((item) => item.id));
      setSelectedIds((current) => {
        const next = new Set([...current].filter((id) => present.has(id)));
        return next.size === current.size ? current : next;
      });
    } catch {
      // Rede fora: fica a lista que está na tela.
    }
  }, []);

  useTableSignal("notifications", refresh);

  const handleToggleRead = useCallback(
    async (id: string, nextRead: boolean) => {
      const previous = notifications.find((item) => item.id === id);
      if (!previous || pendingIds.has(id)) return;
      const wasRead = previous.read;

      setPendingIds((current) => new Set(current).add(id));
      setError(null);

      // Otimismo: muda na hora.
      setNotifications((current) =>
        current.map((item) =>
          item.id === id ? { ...item, read: nextRead } : item
        )
      );
      setUnreadCount((current) =>
        nextRead ? Math.max(0, current - 1) : current + 1
      );

      function revert(message: string) {
        setNotifications((current) =>
          current.map((item) =>
            item.id === id ? { ...item, read: wasRead } : item
          )
        );
        setUnreadCount((current) =>
          wasRead ? current + 1 : Math.max(0, current - 1)
        );
        setError(message);
      }

      try {
        const response = await fetch(`/api/notifications/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ read: nextRead }),
        });
        if (!response.ok) revert("Não foi possível atualizar a notificação.");
      } catch {
        revert("Sem conexão. A notificação não foi atualizada.");
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

  // A ação de um aviso deu certo no servidor, que já o marcou como lido e
  // resolvido: espelha aqui, sem rebuscar a lista.
  const handleActionTaken = useCallback(
    (id: string) => {
      const target = notifications.find((item) => item.id === id);
      setNotifications((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                read: true,
                metadata: {
                  ...((item.metadata as Record<string, unknown> | null) ?? {}),
                  actionTakenAt: new Date().toISOString(),
                },
              }
            : item
        )
      );
      if (target && !target.read) setUnreadCount((current) => Math.max(0, current - 1));
    },
    [notifications]
  );

  const handleMarkAllRead = useCallback(async () => {
    if (unreadCount === 0) return;

    const previous = notifications;
    const previousCount = unreadCount;
    setNotifications((current) =>
      current.map((item) => (!item.read ? { ...item, read: true } : item))
    );
    setUnreadCount(0);
    setError(null);

    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "PATCH",
      });

      if (!response.ok) {
        setNotifications(previous);
        setUnreadCount(previousCount);
        setError("Não foi possível marcar todas como lidas.");
      }
    } catch {
      setNotifications(previous);
      setUnreadCount(previousCount);
      setError("Sem conexão. As notificações continuam não lidas.");
    }
  }, [notifications, unreadCount]);

  function leaveSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const everySelected =
    notifications.length > 0 && notifications.every((item) => selectedIds.has(item.id));

  function toggleAll() {
    setSelectedIds(
      everySelected ? new Set() : new Set(notifications.map((item) => item.id))
    );
  }

  async function markSelected(read: boolean) {
    const ids = [...selectedIds];
    if (ids.length === 0 || bulkBusy) return;

    const previous = notifications;
    const previousCount = unreadCount;
    const changed = notifications.filter(
      (item) => selectedIds.has(item.id) && item.read !== read
    ).length;

    setBulkBusy(true);
    setError(null);
    setNotifications((current) =>
      current.map((item) => (selectedIds.has(item.id) ? { ...item, read } : item))
    );
    setUnreadCount((current) =>
      read ? Math.max(0, current - changed) : current + changed
    );

    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, read }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setSelectedIds(new Set());
      setAnnouncement(
        `${ids.length} ${ids.length === 1 ? "notificação marcada" : "notificações marcadas"} como ${read ? "lida" : "não lida"}${ids.length === 1 ? "" : "s"}.`
      );
    } catch {
      setNotifications(previous);
      setUnreadCount(previousCount);
      setError(
        read
          ? "Não foi possível marcar as selecionadas como lidas."
          : "Não foi possível marcar as selecionadas como não lidas."
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0 || bulkBusy) return;

    setBulkBusy(true);
    setDeleteError(null);

    try {
      const response = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) {
        setDeleteError(
          response.status === 429
            ? "Muitas exclusões seguidas. Aguarde um pouco e tente de novo."
            : "Não foi possível apagar. Tente de novo."
        );
        return;
      }

      const removedUnread = notifications.filter(
        (item) => selectedIds.has(item.id) && !item.read
      ).length;
      const remaining = notifications.filter((item) => !selectedIds.has(item.id));
      setNotifications(remaining);
      setUnreadCount((current) => Math.max(0, current - removedUnread));
      setSelectedIds(new Set());
      setConfirmingDelete(false);
      if (remaining.length === 0) setSelectionMode(false);
      setAnnouncement(
        `${ids.length} ${ids.length === 1 ? "notificação apagada" : "notificações apagadas"}.`
      );
    } catch {
      setDeleteError("Sem conexão. Nada foi apagado.");
    } finally {
      setBulkBusy(false);
    }
  }

  const selectedCount = selectedIds.size;
  const truncated = notifications.length >= NOTIFICATIONS_LIMIT;

  return (
    // A mesma "janela" de Tags e Configurações: moldura arredondada sobre o
    // fundo, com o caminho de volta ao Início.
    <div className="flex min-h-dvh bg-secondary p-3">
      <main className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-background">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-10 sm:px-6 sm:py-14">
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
            Tarefas da IA que terminaram ou falharam, limites de leitura e
            avisos da sua instância. Cada tarefa leva ao detalhe dela em
            Tarefas.
          </p>

          {error && (
            <p className="mt-4 text-sm text-error" role="alert">
              {error}
            </p>
          )}

          {/* Sem fundo próprio: a moldura já está sobre `bg-background`, e as
              linhas não lidas se destacam com `bg-secondary/40`. */}
          <section className="mt-7 flex flex-col rounded-2xl border border-border">
            <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-2">
              <div className="flex items-center gap-2.5">
                <h2 className="text-sm font-semibold text-foreground">Todas</h2>
                {unreadCount > 0 && (
                  <span
                    title={unreadCount === 1 ? "1 não lida" : `${unreadCount} não lidas`}
                    className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
                  >
                    {unreadCount}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                {!selectionMode && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    disabled={unreadCount === 0}
                    className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-10"
                  >
                    <MailOpen className="size-3.5" aria-hidden="true" />
                    Marcar todas como lidas
                  </button>
                )}
                <button
                  type="button"
                  aria-pressed={selectionMode}
                  disabled={!selectionMode && notifications.length === 0}
                  onClick={() => (selectionMode ? leaveSelection() : setSelectionMode(true))}
                  className={cn(
                    "h-8 shrink-0 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 pointer-coarse:h-10",
                    selectionMode
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-foreground hover:bg-secondary"
                  )}
                >
                  {selectionMode ? "Concluir" : "Selecionar"}
                </button>
              </div>
            </header>

            {selectionMode && (
              // Presa ao topo enquanto rola: com duzentas linhas, a ação não
              // pode ficar lá em cima, fora de vista.
              <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium text-foreground" aria-live="polite">
                  {selectedCount === 0
                    ? "Escolha as notificações"
                    : `${selectedCount} ${selectedCount === 1 ? "selecionada" : "selecionadas"}`}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="h-8 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:h-10"
                  >
                    {everySelected ? "Limpar seleção" : "Selecionar todas"}
                  </button>
                  <button
                    type="button"
                    disabled={selectedCount === 0 || bulkBusy}
                    onClick={() => void markSelected(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-45 pointer-coarse:h-10"
                  >
                    <MailOpen className="size-3.5" aria-hidden="true" />
                    Marcar como lida
                  </button>
                  <button
                    type="button"
                    disabled={selectedCount === 0 || bulkBusy}
                    onClick={() => void markSelected(false)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-45 pointer-coarse:h-10"
                  >
                    <Mail className="size-3.5" aria-hidden="true" />
                    Não lida
                  </button>
                  <button
                    type="button"
                    disabled={selectedCount === 0 || bulkBusy}
                    onClick={() => {
                      setDeleteError(null);
                      setConfirmingDelete(true);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-error px-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/50 disabled:pointer-events-none disabled:opacity-45 dark:text-background pointer-coarse:h-10"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Apagar
                  </button>
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1">
              {notifications.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="size-5" aria-hidden="true" />}
                  title="Nada na entrada"
                  description="Quando uma tarefa da IA terminar ou falhar, ou a Nexo tiver algo a dizer, aparece aqui."
                />
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-b-2xl">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      now={now}
                      onToggleRead={handleToggleRead}
                      onActionTaken={handleActionTaken}
                      disabled={pendingIds.has(notification.id)}
                      selectionMode={selectionMode}
                      selected={selectedIds.has(notification.id)}
                      onToggleSelected={toggleSelected}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>

          {truncated && (
            <p className="mt-3 text-center text-xs text-subtle-foreground">
              Mostrando as {NOTIFICATIONS_LIMIT} mais recentes. Apague as que
              já não servem para ver as anteriores.
            </p>
          )}
        </div>
      </main>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      <ConfirmDialog
        open={confirmingDelete}
        title={
          selectedCount === 1 ? "Apagar esta notificação?" : `Apagar ${selectedCount} notificações?`
        }
        description="Só o aviso sai da Entrada. As tarefas, as notas e os arquivos a que ele se refere continuam onde estão. Não dá para desfazer."
        confirmLabel={selectedCount === 1 ? "Apagar notificação" : "Apagar notificações"}
        busyLabel="Apagando…"
        busy={bulkBusy}
        error={deleteError}
        onOpenChange={(open) => {
          if (!open && !bulkBusy) setConfirmingDelete(false);
        }}
        onConfirm={() => void deleteSelected()}
      />
    </div>
  );
}
