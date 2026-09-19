"use client";

import { useCallback, useRef, useState } from "react";

import { useTableSignal } from "@/hooks/use-table-signal";

/**
 * O número de notificações não lidas, vivo.
 *
 * Começa pelo que o servidor pintou e rebusca a cada mudança em
 * `notifications` — uma tarefa que termina (0031) sobe o número sem a pessoa
 * recarregar nada. A resposta mais recente vence; uma atrasada é descartada.
 */
export function useUnreadCount(initial: number) {
  const [count, setCount] = useState(initial);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const response = await fetch("/api/notifications/unread", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { unreadCount?: unknown };
      if (ticket === latest.current && typeof body.unreadCount === "number") {
        setCount(body.unreadCount);
      }
    } catch {
      // Rede fora: fica o último número bom. O próximo evento tenta de novo.
    }
  }, []);

  useTableSignal("notifications", refresh);

  return count;
}
