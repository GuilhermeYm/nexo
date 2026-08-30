"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * O rascunho do dashboard — a única coisa da Nexo que **não** vai sozinha
 * para o servidor.
 *
 * Tudo o mais aqui grava sozinho: a nota da lousa, o editor, o post-it. É a
 * promessa central do produto — jogue aqui dentro e não pense mais nisso. O
 * rascunho é o contrário disso de propósito, e serve para o momento anterior
 * a esse: a ideia meio formada, o telefone ditado na pressa, o texto que a
 * pessoa ainda não decidiu se quer na conta. Guardar isso automaticamente
 * encheria a busca de fragmentos que ninguém pediu para guardar.
 *
 * Então ele mora no `localStorage`: sobrevive a recarregar a página e a
 * fechar o navegador, e **não** atravessa para o celular. É memória de
 * guardanapo, e a interface diz isso com todas as letras — porque limpar os
 * dados do navegador leva o rascunho junto, e ninguém deveria descobrir isso
 * depois.
 *
 * O caminho de saída é um botão só: "Guardar na conta" cria a nota de
 * verdade, com busca, tags e sincronização. O rascunho some **depois** que o
 * servidor confirma, nunca antes — até lá ele é a única cópia que existe.
 */

const STORAGE_KEY = "nexo-draft";

export interface LocalDraft {
  title: string;
  /**
   * Texto puro. É o que vai para `POST /api/notes` quando não há documento,
   * e o que decide se o rascunho tem conteúdo. O editor o mantém em sincronia
   * com `contentRich` a cada tecla.
   */
  content: string;
  /**
   * O documento do editor (TipTap/ProseMirror), quando a pessoa já escreveu
   * com ele. Ausente nos rascunhos criados antes do editor — nesse caso o
   * editor abre a partir do `content`.
   */
  contentRich?: unknown;
  /** Quando a última tecla caiu. Só para o rótulo de "escrito há…". */
  updatedAt: number;
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage bloqueado: o rascunho vale só enquanto a aba estiver aberta.
    return null;
  }
}

/** O storage é editável pela pessoa: nada entra sem ser conferido. */
function parse(raw: string | null): LocalDraft | null {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const value = parsed as Partial<LocalDraft>;
    if (typeof value.title !== "string" || typeof value.content !== "string") {
      return null;
    }

    // O documento é opcional e só vale se for um objeto — um `null` ou um
    // primitivo no storage editado à mão não deve virar `content` do editor.
    const contentRich =
      typeof value.contentRich === "object" && value.contentRich !== null
        ? value.contentRich
        : undefined;

    return {
      title: value.title,
      content: value.content,
      contentRich,
      updatedAt:
        typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
          ? value.updatedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

export function useLocalDraft() {
  const subscribe = useCallback((onChange: () => void) => {
    function handle(event: StorageEvent) {
      if (event.key === STORAGE_KEY) onChange();
    }

    window.addEventListener("storage", handle);
    return () => window.removeEventListener("storage", handle);
  }, []);

  // O retrato é a string crua: um objeto novo a cada chamada faria o
  // `useSyncExternalStore` ver mudança em toda comparação e o render entraria
  // em laço. A conversão sai depois, memorizada.
  const raw = useSyncExternalStore(
    subscribe,
    readRaw,
    // No servidor não existe storage. O primeiro HTML vem sem rascunho, e a
    // hidratação traz o que houver — é para exatamente isto que o
    // `useSyncExternalStore` tem dois retratos.
    () => null
  );
  const draft = useMemo(() => parse(raw), [raw]);

  const write = useCallback((next: LocalDraft | null) => {
    try {
      if (next === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Sem persistência o rascunho vale só para esta sessão — mas o aviso
      // abaixo ainda faz este documento se redesenhar.
    }
    // `setItem` não dispara `storage` na própria aba; o aviso é manual.
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  }, []);

  /**
   * Grava a cada tecla, sem esperar.
   *
   * O `useBoardViewport` adia a escrita meio segundo porque um arraste
   * dispara dezenas de eventos por segundo; digitar não chega perto disso, e
   * adiar aqui seria arriscar o único lugar onde este texto existe por meio
   * segundo a cada tecla.
   */
  const update = useCallback(
    (
      patch: Partial<Pick<LocalDraft, "title" | "content">> & {
        contentRich?: unknown;
      }
    ) => {
      write({
        title: patch.title ?? draft?.title ?? "",
        content: patch.content ?? draft?.content ?? "",
        // `"contentRich" in patch` e não `patch.contentRich ?? …`: o editor
        // manda o documento junto com o texto a cada tecla, mas uma edição só
        // de título não pode zerar o documento que já existe.
        contentRich:
          "contentRich" in patch ? patch.contentRich : draft?.contentRich,
        updatedAt: Date.now(),
      });
    },
    [draft, write]
  );

  const discard = useCallback(() => write(null), [write]);

  return { draft, update, discard };
}
