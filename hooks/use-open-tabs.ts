"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Quais lugares estão à mão na barra de cima, neste dispositivo.
 *
 * A barra listava **todos** os workspaces, sempre, e não havia como tirar
 * nenhum: quem cria dez workspaces ganha dez abas para sempre. Agora ela
 * lista os que a pessoa deixou abertos, e a lista completa continua no
 * trilho, ao lado.
 *
 * **Fechar não é excluir.** Tirar uma aba da barra não toca no banco: o
 * workspace continua inteiro, com as notas e o arranjo da lousa, a um clique
 * no trilho. É por isso que este dado mora no `localStorage` e não no
 * Postgres — como o enquadramento da lousa, ele é de dispositivo. O monitor
 * de trabalho e o celular não querem as mesmas abas abertas, e sincronizar
 * isso entre os dois seria briga, não sincronização.
 *
 * O padrão, para quem nunca mexeu, é o que existia antes: o Início mais
 * todos os workspaces. A partir da primeira mudança vale a escolha da
 * pessoa — inclusive a de ter fechado tudo.
 */

const STORAGE_KEY = "nexo-open-tabs";

/** O identificador do dashboard na lista. Nenhum workspace tem esse id. */
export const HOME_TAB = "home";

function read(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage bloqueado (janela privada, política do navegador).
    return null;
  }
}

/**
 * O storage é editável pela pessoa: nada aqui é confiável antes de conferido.
 * Um JSON de outro formato não pode apagar a barra da tela.
 */
function parse(raw: string | null): string[] | null {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return null;
  }
}

export function useOpenTabs(workspaces: { id: string }[]) {
  const subscribe = useCallback((onChange: () => void) => {
    function handle(event: StorageEvent) {
      if (event.key === STORAGE_KEY) onChange();
    }

    window.addEventListener("storage", handle);
    return () => window.removeEventListener("storage", handle);
  }, []);

  // O retrato é a **string** crua, não a lista já convertida. Um array novo
  // a cada chamada faria o `useSyncExternalStore` ver mudança em toda
  // comparação e o render entraria em laço; uma string primitiva se compara
  // por valor, e a conversão sai depois, memorizada.
  const raw = useSyncExternalStore(
    subscribe,
    read,
    // No servidor não existe storage: vale o padrão.
    () => null
  );
  const stored = useMemo(() => parse(raw), [raw]);

  const tabs = useMemo(() => {
    const ids = workspaces.map((workspace) => workspace.id);
    if (stored === null) return [HOME_TAB, ...ids];

    // Um workspace excluído em outro dispositivo não pode continuar como aba
    // apontando para uma rota que devolve 404.
    const known = new Set(ids);
    return stored.filter((id) => id === HOME_TAB || known.has(id));
  }, [stored, workspaces]);

  const write = useCallback((next: string[]) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Sem persistência a escolha vale só para esta sessão — mas o aviso
      // abaixo ainda faz este documento se redesenhar.
    }
    // `setItem` não dispara `storage` na própria aba; o aviso é manual.
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  }, []);

  /**
   * Põe na barra, se ainda não estiver lá.
   *
   * Workspace entra no fim, na ordem em que a pessoa foi abrindo. O Início
   * entra na frente: ele é o lugar de onde tudo parte, e reabri-lo depois de
   * fechar não deveria deixá-lo no meio de uma fila de workspaces, num lugar
   * diferente do que ele ocupava antes.
   */
  const openTab = useCallback(
    (id: string) => {
      if (tabs.includes(id)) return;
      write(id === HOME_TAB ? [id, ...tabs] : [...tabs, id]);
    },
    [tabs, write]
  );

  const closeTab = useCallback(
    (id: string) => write(tabs.filter((tab) => tab !== id)),
    [tabs, write]
  );

  return { tabs, openTab, closeTab };
}
