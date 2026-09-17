"use client";

import { useMemo, useSyncExternalStore } from "react";

import {
  ACCOUNTS_EVENT,
  type KnownAccount,
  parseKnownAccounts,
  readKnownAccountsRaw,
} from "@/lib/accounts";

/**
 * As contas lembradas neste navegador, prontas para o React.
 *
 * O retrato do `useSyncExternalStore` é a string crua (estável entre
 * chamadas quando nada mudou); a conversão para array sai depois, memorizada
 * — mesma separação do `useLocalDraft`, e pela mesma razão: um array novo a
 * cada leitura faria `useSyncExternalStore` ver mudança em todo render e
 * entrar em loop.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(ACCOUNTS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(ACCOUNTS_EVENT, onChange);
  };
}

export function useKnownAccounts(): KnownAccount[] {
  const raw = useSyncExternalStore(subscribe, readKnownAccountsRaw, () => null);
  return useMemo(() => parseKnownAccounts(raw), [raw]);
}
