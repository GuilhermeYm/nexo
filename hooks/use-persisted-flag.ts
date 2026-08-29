"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Uma preferência booleana guardada no `localStorage` deste dispositivo.
 *
 * O caminho óbvio — ler o storage num `useEffect` e chamar `setState` — é
 * justamente o que o React 19 desaconselha: o efeito roda depois da
 * hidratação e dispara um segundo render em cascata. `useSyncExternalStore`
 * existe para este caso: ele tem um retrato para o servidor (o padrão) e
 * outro para o cliente (o storage), e o React reconcilia os dois sem
 * mismatch de hidratação e sem render extra por efeito.
 *
 * A assinatura no evento `storage` é de graça e resolve um caso real: duas
 * abas abertas no mesmo dispositivo passam a concordar sobre a preferência.
 */
export function usePersistedFlag(key: string, fallback: boolean) {
  const subscribe = useCallback((onChange: () => void) => {
    function handle(event: StorageEvent) {
      if (event.key === key) onChange();
    }

    window.addEventListener("storage", handle);
    return () => window.removeEventListener("storage", handle);
  }, [key]);

  const getSnapshot = useCallback(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === "1") return true;
      if (stored === "0") return false;
    } catch {
      // Storage bloqueado (modo privado, política do navegador).
    }
    return fallback;
  }, [key, fallback]);

  const value = useSyncExternalStore(
    subscribe,
    getSnapshot,
    // No servidor não existe storage: vale o padrão.
    () => fallback
  );

  const setValue = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Sem persistência a escolha vale só para esta sessão — mas o evento
        // abaixo ainda avisa este documento para re-renderizar.
      }
      // `localStorage.setItem` não dispara `storage` na própria aba, então o
      // aviso é manual.
      window.dispatchEvent(new StorageEvent("storage", { key }));
    },
    [key]
  );

  return [value, setValue] as const;
}
