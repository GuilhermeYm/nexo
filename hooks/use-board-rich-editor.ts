"use client";

import { useSyncExternalStore } from "react";

import {
  PREFERENCES_EVENT,
  readBoardRichEditor,
} from "@/lib/preferences";

/**
 * A preferência "editor rico na lousa", pronta para o React.
 *
 * `useSyncExternalStore` porque a fonte é externa ao React (o `localStorage`):
 * o snapshot do servidor é sempre `false` (o `textarea` leve), então o HTML
 * das duas pontas bate; no cliente ele lê o valor real e re-renderiza se a
 * preferência mudar — no mesmo separador (`nexo-preferences`) ou noutro
 * (`storage`).
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(PREFERENCES_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PREFERENCES_EVENT, onChange);
  };
}

export function useBoardRichEditor(): boolean {
  return useSyncExternalStore(subscribe, readBoardRichEditor, () => false);
}
