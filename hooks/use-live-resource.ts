"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { authorizeRealtime } from "@/lib/supabase/realtime";

type TableName = "notes" | "ai_jobs" | "workspaces";

interface Options<T> {
  /** Rota que devolve o estado completo do painel. */
  endpoint: string;
  /** Chave do array dentro da resposta JSON. */
  field: string;
  /** Estado pintado no servidor — o painel nunca começa vazio. */
  initial: T[];
  /** Tabelas cujas mudanças invalidam este painel. */
  tables: TableName[];
}

export type LiveStatus = "live" | "connecting" | "offline";

/**
 * Um painel do dashboard que se mantém vivo.
 *
 * O Postgres é a fonte da verdade; o Realtime do Supabase é só o sino. Quando
 * uma linha muda em qualquer dispositivo, o evento chega aqui e este hook
 * *rebusca a rota* em vez de aplicar o payload do evento na lista local.
 *
 * Isso é deliberado, e é o que faz a sincronização entre plataformas ser
 * correta em vez de aproximada:
 *
 * - A rota devolve dados já compostos (tags via join, nome do workspace,
 *   ordenação com pendentes no topo). Reproduzir essa composição no cliente a
 *   partir de um payload de linha crua seria uma segunda implementação da
 *   mesma regra, e as duas divergiriam.
 * - Um INSERT e um UPDATE fora de ordem não conseguem corromper a lista:
 *   cada resposta é um retrato inteiro e consistente, não um patch.
 * - O que o usuário pode ver continua decidido pela RLS no servidor. O
 *   Realtime também aplica RLS por conexão, então são duas barreiras — mas a
 *   que vale é sempre a do banco.
 *
 * O custo é uma requisição por rajada de eventos. Por isso os eventos são
 * agrupados numa janela curta: dez tags gravadas em sequência viram uma
 * rebusca, não dez.
 */
export function useLiveResource<T>({
  endpoint,
  field,
  initial,
  tables,
}: Options<T>) {
  const [items, setItems] = useState<T[]>(initial);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // A rebusca em voo é abortada quando outra começa: a última resposta é a
  // que vale, e uma anterior chegando atrasada não pode sobrescrevê-la.
  const inFlight = useRef<AbortController | null>(null);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setIsRefreshing(true);
    try {
      const response = await fetch(endpoint, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return;

      const payload = await response.json();
      if (Array.isArray(payload[field])) setItems(payload[field]);
    } catch {
      // Abort ou rede fora: o painel mantém o último estado bom em vez de
      // piscar vazio. O próximo evento (ou o retorno da aba) tenta de novo.
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setIsRefreshing(false);
      }
    }
  }, [endpoint, field]);

  const scheduleRefresh = useCallback(() => {
    if (burstTimer.current) clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(refresh, 250);
  }, [refresh]);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // O socket precisa do token **antes** de assinar: sem ele a RLS do
    // Realtime não reconhece o usuário e o canal fica inscrito sem nunca
    // receber nada. Ver lib/supabase/realtime.ts.
    void (async () => {
      await authorizeRealtime(supabase);
      if (cancelled) return;

      channel = supabase.channel(`dashboard:${tables.join("-")}`);

      for (const table of tables) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          scheduleRefresh
        );
      }

      channel.subscribe((state) => {
        if (state === "SUBSCRIBED") setStatus("live");
        else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT")
          setStatus("offline");
        else if (state === "CLOSED") setStatus("connecting");
      });
    })();

    // Voltar para a aba é o momento em que o estado tem mais chance de estar
    // velho: o websocket pode ter caído enquanto ela estava em segundo plano.
    function handleVisibility() {
      if (document.visibilityState === "visible") scheduleRefresh();
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (burstTimer.current) clearTimeout(burstTimer.current);
      inFlight.current?.abort();
      if (channel) supabase.removeChannel(channel);
    };
    // `tables` é uma constante literal em cada uso; a chave estável evita
    // reassinar o canal a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleRefresh, tables.join("-")]);

  return { items, status, isRefreshing, refresh };
}
