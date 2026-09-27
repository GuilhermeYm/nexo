"use client";

import { useEffect } from "react";

/**
 * Desabilita o menu de contexto nativo do navegador dentro da lousa.
 *
 * O menu de contexto da lousa é aberto com duplo clique do botão esquerdo,
 * então o menu nativo do navegador (botão direito) só atrapalha.
 */
export function DisableNativeContextMenu() {
  useEffect(() => {
    function handleContextMenu(event: MouseEvent) {
      event.preventDefault();
    }

    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  return null;
}
