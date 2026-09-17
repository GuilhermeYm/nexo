"use client";

import { useSyncExternalStore } from "react";

import { PREFERENCES_EVENT, readHideDraft } from "@/lib/preferences";

/**
 * A preferência "ocultar o rascunho no dashboard", pronta para o React.
 *
 * Mesmo padrão de `useBoardRichEditor`: o snapshot do servidor é sempre
 * `false` (o convite aparece) para o HTML das duas pontas bater, e o cliente
 * lê o valor real depois da hidratação.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(PREFERENCES_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PREFERENCES_EVENT, onChange);
  };
}

export function useHideDraft(): boolean {
  return useSyncExternalStore(subscribe, readHideDraft, () => false);
}
