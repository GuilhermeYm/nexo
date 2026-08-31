"use client";

import { useSyncExternalStore } from "react";

import { localDayKey } from "@/lib/agenda/day";

/**
 * Que dia é hoje, no relógio de **quem está olhando**.
 *
 * `null` no servidor e durante a hidratação; a chave local depois disso. É
 * essa fronteira que faz o dia da Agenda nunca divergir entre os dois lados:
 * o servidor não tem como saber o fuso do navegador, então ele não tenta —
 * renderiza `null`, e o valor real entra num segundo render.
 *
 * `useSyncExternalStore` e não um `useEffect` com `setState`: o dia é estado
 * de um sistema externo (o relógio do aparelho), que é exatamente o caso de
 * uso deste hook. Um efeito que chama `setState` na montagem faz render em
 * cascata, e o próprio ESLint do React reclama disso com razão.
 *
 * ## A virada de dia com a aba aberta
 *
 * O recheque acontece **só quando a aba volta a ficar visível** — nunca por
 * um relógio correndo por baixo de quem está digitando. Trocar o dia debaixo
 * de alguém no meio de uma frase mandaria a linha para a lista errada, e
 * perder trabalho é um defeito muito pior do que mostrar "Hoje" por mais
 * alguns minutos para quem virou a madrugada na mesma aba.
 */

/**
 * O valor corrente, no módulo.
 *
 * `getSnapshot` precisa devolver algo estável entre chamadas — se ele
 * calculasse `localDayKey()` toda vez, seria uma string nova a cada render.
 * (Strings comparam por valor, então não haveria laço infinito; ainda assim,
 * cachear é o contrato do hook e deixa a intenção explícita.)
 */
let cached: string | null = null;

function getSnapshot(): string {
  if (cached === null) cached = localDayKey();
  return cached;
}

/** No servidor não existe "hoje" de ninguém. */
function getServerSnapshot(): string | null {
  return null;
}

function subscribe(onStoreChange: () => void): () => void {
  function recheck() {
    if (document.visibilityState !== "visible") return;
    const now = localDayKey();
    if (now === cached) return;
    cached = now;
    onStoreChange();
  }

  document.addEventListener("visibilitychange", recheck);
  return () => document.removeEventListener("visibilitychange", recheck);
}

export function useLocalDay(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
