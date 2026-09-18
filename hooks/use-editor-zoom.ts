"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useSyncExternalStore } from "react";

export const DEFAULT_EDITOR_ZOOM = 100;
export const MIN_EDITOR_ZOOM = 80;
export const MAX_EDITOR_ZOOM = 160;
export const EDITOR_ZOOM_STEP = 10;

function clampZoom(value: number): number {
  return Math.min(MAX_EDITOR_ZOOM, Math.max(MIN_EDITOR_ZOOM, value));
}

function parseZoom(raw: string | null): number {
  const value = Number(raw);
  return Number.isFinite(value) ? clampZoom(value) : DEFAULT_EDITOR_ZOOM;
}

/**
 * Zoom é uma preferência de leitura por dispositivo, nunca parte da nota.
 * Cada editor recebe uma chave: o rascunho pode ser ampliado sem transformar
 * a escala escolhida para uma nota completa (e vice-versa).
 */
export function useEditorZoom(storageKey: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      function handle(event: StorageEvent) {
        if (event.key === storageKey) onChange();
      }

      window.addEventListener("storage", handle);
      return () => window.removeEventListener("storage", handle);
    },
    [storageKey]
  );

  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }, [storageKey]);

  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const zoom = parseZoom(raw);

  const setZoom = useCallback(
    (next: number) => {
      const value = clampZoom(next);
      try {
        window.localStorage.setItem(storageKey, String(value));
      } catch {
        // Sem storage, a preferência vale só até desmontar este editor.
      }
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
    },
    [storageKey]
  );

  return {
    zoom,
    decrease: () => setZoom(zoom - EDITOR_ZOOM_STEP),
    increase: () => setZoom(zoom + EDITOR_ZOOM_STEP),
    reset: () => setZoom(DEFAULT_EDITOR_ZOOM),
  };
}

/** Atalhos locais: impedem o zoom do navegador somente dentro do editor. */
export function useEditorZoomShortcuts(
  editor: Editor | null,
  controls: ReturnType<typeof useEditorZoom>
) {
  useEffect(() => {
    if (!editor) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        controls.increase();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        controls.decrease();
      } else if (event.key === "0") {
        event.preventDefault();
        controls.reset();
      }
    }

    const dom = editor.view.dom;
    dom.addEventListener("keydown", handleKeyDown);
    return () => dom.removeEventListener("keydown", handleKeyDown);
  }, [controls, editor]);
}
