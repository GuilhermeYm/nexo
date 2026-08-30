"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Quais itens de uma lista **acabaram de chegar** desde o último render.
 *
 * Os painéis do dashboard (`useLiveResource`) trocam a lista inteira quando o
 * Realtime avisa que algo mudou. Este hook compara a lista nova com a anterior
 * e devolve os ids que entraram, para a linha correspondente animar a entrada.
 *
 * O estado inicial veio do servidor: nada nele "entrou", então o primeiro
 * render nunca marca ninguém. Cada id marcado se desmarca sozinho depois de
 * `ttlMs` — a classe de animação sai e não volta a disparar em renders
 * seguintes que não têm nada a ver com aquela linha.
 */
export function useNewItems<T>(
  items: T[],
  getId: (item: T) => string,
  ttlMs = 1400
): ReadonlySet<string> {
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const seen = useRef<Set<string>>(new Set(items.map(getId)));

  useEffect(() => {
    const ids = items.map(getId);
    const added = ids.filter((id) => !seen.current.has(id));
    seen.current = new Set(ids);

    if (added.length === 0) return;

    setFresh((current) => new Set([...current, ...added]));

    const timer = setTimeout(() => {
      setFresh((current) => {
        const next = new Set(current);
        for (const id of added) next.delete(id);
        return next;
      });
    }, ttlMs);

    return () => clearTimeout(timer);
  }, [items, getId, ttlMs]);

  return fresh;
}
