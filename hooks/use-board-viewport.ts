"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Para onde *esta tela* está olhando na lousa.
 *
 * Este é o único dado da lousa que mora no `localStorage`, e mora com razão:
 * pan e zoom são de dispositivo, não da conta. A pessoa quer a lousa inteira
 * enquadrada no monitor e um pedaço ampliado no celular — sincronizar isso
 * entre os dois seria briga, não sincronização. O arranjo das janelas, esse
 * é trabalho dela e vive no Postgres.
 *
 * Como não existe storage no servidor, o primeiro render usa o padrão nos
 * dois lados e a restauração acontece antes do primeiro paint — daí o
 * layout effect. `useEffect` correria depois de pintar e a lousa daria um
 * salto visível a cada carregamento.
 */

export interface Viewport {
  /** Deslocamento em pixels de tela. */
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2;
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/** No servidor o layout effect não existe; lá o efeito comum é inócuo. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function storageKey(workspaceId: string) {
  return `nexo-board-viewport:${workspaceId}`;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Retângulo que contém todas as janelas, em coordenadas da lousa. */
export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function useBoardViewport(workspaceId: string) {
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  /**
   * Este dispositivo já tinha um enquadramento guardado?
   *
   * Quem usa isto é o Board: sem enquadramento salvo, ele enquadra o
   * conteúdo sozinho. É o que impede um celular de abrir uma lousa montada
   * no monitor e mostrar uma superfície vazia com as janelas fora da tela.
   * `null` = ainda não foi lido do storage.
   */
  const [restored, setRestored] = useState<boolean | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useIsomorphicLayoutEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey(workspaceId));
      if (!stored) {
        setRestored(false);
        return;
      }

      const parsed = JSON.parse(stored) as Partial<Viewport>;
      // O storage é editável pelo usuário: nada aqui é confiável antes de
      // ser conferido. Um NaN no zoom apagaria a lousa da tela.
      if (
        typeof parsed.x === "number" &&
        typeof parsed.y === "number" &&
        typeof parsed.zoom === "number" &&
        Number.isFinite(parsed.x) &&
        Number.isFinite(parsed.y) &&
        Number.isFinite(parsed.zoom)
      ) {
        setViewport({
          x: parsed.x,
          y: parsed.y,
          zoom: clampZoom(parsed.zoom),
        });
        setRestored(true);
        return;
      }
      setRestored(false);
    } catch {
      // Storage bloqueado ou JSON corrompido: vale o padrão.
      setRestored(false);
    }
  }, [workspaceId]);

  // Gravar a cada quadro de um pan seria escrita síncrona no meio do
  // arraste; meio segundo depois que a pessoa para basta.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(
          storageKey(workspaceId),
          JSON.stringify(viewport)
        );
      } catch {
        // Sem persistência o enquadramento vale só para esta sessão.
      }
    }, 500);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [viewport, workspaceId]);

  /** Converte um ponto da tela para as coordenadas da lousa. */
  const toBoard = useCallback(
    (screenX: number, screenY: number) => ({
      x: (screenX - viewport.x) / viewport.zoom,
      y: (screenY - viewport.y) / viewport.zoom,
    }),
    [viewport]
  );

  /**
   * Amplia mantendo fixo o ponto sob o cursor.
   *
   * Sem isso o zoom acontece a partir do canto da tela e a pessoa perde de
   * vista aquilo que estava olhando — o defeito clássico de canvas caseiro.
   *
   * O destino pode vir como número ou como função do zoom atual. A segunda
   * forma não é conveniência: quem amplia por passo — os botões, o teclado,
   * a roda — precisaria ler `viewport.zoom` para calcular o destino, e aí a
   * função mudaria de identidade a cada quadro de zoom. Um ouvinte nativo
   * registrado com ela teria de ser desinstalado e reinstalado no meio do
   * gesto. Lendo o valor de dentro do atualizador, ela nunca muda.
   */
  const zoomTo = useCallback(
    (
      next: number | ((current: number) => number),
      screenX: number,
      screenY: number
    ) => {
      setViewport((current) => {
        const zoom = clampZoom(
          typeof next === "function" ? next(current.zoom) : next
        );
        const ratio = zoom / current.zoom;

        return {
          zoom,
          x: screenX - (screenX - current.x) * ratio,
          y: screenY - (screenY - current.y) * ratio,
        };
      });
    },
    []
  );

  const panBy = useCallback((dx: number, dy: number) => {
    setViewport((current) => ({
      ...current,
      x: current.x + dx,
      y: current.y + dy,
    }));
  }, []);

  /**
   * Enquadra tudo o que existe na lousa.
   *
   * Vale mais que um "voltar a 100%": quando a pessoa se perde no plano, o
   * que ela quer é ver o que tem, não voltar a uma origem que pode não ter
   * nada. Numa lousa vazia, aí sim, volta ao padrão.
   */
  const fitTo = useCallback(
    (bounds: ContentBounds | null, width: number, height: number) => {
      if (!bounds || width <= 0 || height <= 0) {
        setViewport(DEFAULT_VIEWPORT);
        return;
      }

      const padding = 48;
      const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
      const contentHeight = Math.max(1, bounds.maxY - bounds.minY);

      // Nunca amplia além de 100%: enquadrar duas janelas numa tela grande
      // não deve virar zoom de lupa.
      const zoom = clampZoom(
        Math.min(
          (width - padding * 2) / contentWidth,
          (height - padding * 2) / contentHeight,
          1
        )
      );

      setViewport({
        zoom,
        x: (width - contentWidth * zoom) / 2 - bounds.minX * zoom,
        y: (height - contentHeight * zoom) / 2 - bounds.minY * zoom,
      });
    },
    []
  );

  return { viewport, setViewport, restored, toBoard, zoomTo, panBy, fitTo };
}
