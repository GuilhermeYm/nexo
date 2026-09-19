"use client";

import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";
import { authorizeRealtime } from "@/lib/supabase/realtime";

/**
 * Avisa quando uma tabela muda — e só avisa.
 *
 * O mesmo sino de `useLiveResource`, sem a lista: quem usa decide o que
 * rebuscar. Serve a quem não guarda um array de linhas, como o número de não
 * lidas no trilho, ou a quem já tem estado próprio para conciliar, como a
 * Entrada com as ações otimistas.
 *
 * Eventos em rajada viram uma chamada só (250ms), e voltar para a aba também
 * chama — o websocket pode ter caído em segundo plano.
 */
export function useTableSignal(table: "notifications", onChange: () => void) {
  // A função mais recente, sem reassinar o canal a cada render.
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => callback.current(), 250);
    }

    // Sem o token no socket a RLS do Realtime não reconhece ninguém e o canal
    // fica inscrito sem nunca receber nada (docs/REALTIME.md).
    void (async () => {
      await authorizeRealtime(supabase);
      if (cancelled) return;
      channel = supabase
        .channel(`signal:${table}:${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, schedule)
        .subscribe();
    })();

    function handleVisibility() {
      if (document.visibilityState === "visible") schedule();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (timer) clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [table]);
}
