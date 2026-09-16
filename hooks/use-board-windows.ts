"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readApiFailure } from "@/lib/plan-limit";
import { createClient } from "@/lib/supabase/client";
import { authorizeRealtime } from "@/lib/supabase/realtime";
import { paletteFromName } from "@/lib/tags/palette";
import type {
  BoardConnection,
  BoardNoteTag,
  BoardWindow,
  WindowContent,
} from "@/lib/workspace/queries";

/**
 * O estado da lousa.
 *
 * A regra que organiza tudo aqui: **o arraste é local, a persistência é
 * depois.** Mexer uma janela dispara dezenas de eventos por segundo, e todos
 * eles rodam em estado do React sem tocar na rede. Quando a pessoa solta,
 * uma escrita só sai — e mesmo essa espera um instante, porque soltar e
 * mexer de novo é uma coisa só na cabeça de quem está arrastando.
 *
 * O Postgres continua sendo a fonte da verdade e o Realtime continua sendo
 * só o sino, como no dashboard. A diferença é que aqui existe estado local
 * legítimo em voo, então a rebusca não pode simplesmente sobrescrever tudo:
 * as janelas com alteração ainda não confirmada ficam de fora da mesclagem.
 * Sem isso, a lousa daria um pulo para trás no meio do arraste toda vez que
 * o servidor respondesse.
 */

const COMMIT_DELAY = 500;
const NOTE_SAVE_DELAY = 900;
const BURST_WINDOW = 250;

/** Só o que o cliente tem direito de mudar numa janela. */
export interface WindowPatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  zIndex?: number;
  state?: BoardWindow["state"];
  text?: string;
  tone?: string;
  backgroundTone?: WindowContent["backgroundTone"];
  textTone?: WindowContent["textTone"];
}

/**
 * Uma janela como ela volta do apagar — sem o `id`, que na restauração é
 * novo. É o que o "Desfazer" manda de volta para o servidor.
 */
export interface RestorableWindow {
  /**
   * O id que a janela tinha.
   *
   * Volta igual na restauração, e não é detalhe: as flechas apontam para
   * ele. Com id novo, as janelas voltariam soltas e o "Desfazer" desfaria só
   * metade do que a borracha fez.
   */
  id: string;
  kind: BoardWindow["kind"];
  source: BoardWindow["source"];
  noteId: string | null;
  attachmentId: string | null;
  content: BoardWindow["content"];
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  state: BoardWindow["state"];
}

/** Uma flecha como ela volta do apagar: os dois ids e o texto escrito nela. */
export interface RestorableConnection {
  fromWindowId: string;
  toWindowId: string;
  /** O rótulo volta com a flecha — é conteúdo, não geometria. */
  label?: string | null;
}

/** O último lote apagado, enquanto o "Desfazer" ainda está de pé. */
export interface ErasedBatch {
  /** Quantas janelas saíram da lousa. */
  removed: number;
  /** Quantas sumiram de verdade — post-its e caixas de texto. */
  destroyed: number;
  /** Quantas flechas caíram junto, por cascade ou por terem sido encostadas. */
  connections: number;
  windows: RestorableWindow[];
  links: RestorableConnection[];
}

/**
 * O que a borracha vai apagar.
 *
 * Os dois lados são opcionais: uma passada pode ter encostado só em janelas,
 * só em flechas, ou nos dois. `"all"` é o "apagar tudo".
 */
export interface EraseTarget {
  windows?: string[] | "all";
  connections?: string[] | "all";
}

export interface CreateWindowInput {
  kind: BoardWindow["kind"];
  noteId?: string;
  attachmentId?: string;
  title?: string;
  text?: string;
  tone?: string;
  /** Omitidos, o servidor posiciona logo abaixo do que já existe na lousa. */
  x?: number;
  y?: number;
}

type NotePatch = { title?: string; content?: string; contentRich?: unknown };

/**
 * O aviso que a lousa mostra.
 *
 * `upgrade` marca o teto do plano, que **não é defeito**: o cartão troca a
 * cara de erro pelo convite ao Pro, e não pede "tente de novo" para uma coisa
 * que vai ser recusada de novo. Vem do servidor por `readApiFailure`.
 */
export interface BoardNotice {
  message: string;
  upgrade: boolean;
  /**
   * O código do relatório de erro, quando o servidor registrou um defeito.
   * Nulo no teto de plano e em tudo que não é defeito nosso — ver
   * `lib/plan-limit.ts`.
   */
  code?: string | null;
}

/**
 * Uma falha que nunca é teto de plano — rede caiu, 500, cascade recusou.
 *
 * Função pura fora do componente de propósito: como `setError` do `useState`
 * já é estável, nenhum dos sete `useCallback` daqui precisa ganhar uma
 * dependência nova para chamá-la.
 */
function plainNotice(message: string): BoardNotice {
  return { message, upgrade: false, code: null };
}

export function useBoardWindows(
  workspaceId: string,
  initial: BoardWindow[],
  initialConnections: BoardConnection[]
) {
  const [windows, setWindows] = useState<BoardWindow[]>(initial);
  /**
   * As flechas entre as janelas.
   *
   * Moram no mesmo hook porque mudam junto com elas — fechar uma janela leva
   * as flechas dela por cascade — e porque vêm no mesmo retrato. Dois
   * retratos tirados em momentos diferentes desenhariam flecha para janela
   * que já não existe.
   */
  const [connections, setConnections] = useState<BoardConnection[]>(
    initialConnections
  );
  /**
   * O aviso da lousa.
   *
   * Carrega `upgrade` porque bater no teto do plano não é defeito: a lousa
   * mostra o convite para o Pro em vez do texto de erro, e o cartão não pede
   * "tente de novo" para algo que vai recusar de novo.
   */
  const [error, setError] = useState<BoardNotice | null>(null);
  const [lastErased, setLastErased] = useState<ErasedBatch | null>(null);

  const base = `/api/workspaces/${workspaceId}/windows`;
  const connectionsBase = `/api/workspaces/${workspaceId}/connections`;

  // Janelas e notas com alteração local ainda não confirmada. São as que a
  // mesclagem preserva quando um retrato do servidor chega.
  const pendingWindows = useRef(new Set<string>());
  const pendingNotes = useRef(new Set<string>());

  /**
   * Janelas que esta tela acabou de remover.
   *
   * Sem isto, fechar ou excluir tinha uma corrida perdida: o Realtime dispara
   * uma rebusca, ela sai antes de o DELETE chegar ao banco, e o retrato que
   * volta ainda contém a janela — que reaparece na lousa. A lápide sobrevive
   * até um retrato chegar já sem a linha, e só então some.
   */
  const tombstones = useRef(new Set<string>());
  const connectionTombstones = useRef(new Set<string>());

  /**
   * Pares com um POST de ligação em voo.
   *
   * A criação não é otimista — o id vem do servidor —, então até a resposta
   * chegar não há nada na lista dizendo que aquela flecha está a caminho.
   * Dois toques rápidos no mesmo par disparavam dois POST, e o segundo
   * voltava 409 com cara de erro.
   */
  const connecting = useRef(new Set<string>());

  const windowTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const noteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queuedWindow = useRef(new Map<string, WindowPatch>());
  const queuedNote = useRef(new Map<string, NotePatch>());

  /**
   * Espelho da lista, para quem precisa dela fora de um atualizador de
   * estado. O "apagar tudo" é isso: ele decide o que marcar como apagado
   * antes de chamar `setWindows`, e o atualizador precisa continuar puro.
   */
  const latest = useRef<BoardWindow[]>(initial);
  const latestConnections = useRef<BoardConnection[]>(initialConnections);

  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  /* ---------------------------------------------------------------- */
  /* Leitura                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Aplica um retrato do servidor.
   *
   * Um caminho só para toda resposta que traz a lousa — a rebusca, a criação,
   * a borracha, o desfazer. As janelas passam pela mesclagem (o que está em
   * voo aqui não pode ser atropelado por uma resposta que saiu antes); as
   * flechas não têm gesto em andamento, então basta tirar as que esta tela
   * acabou de remover e ainda não foram confirmadas.
   */
  const applySnapshot = useCallback((body: unknown) => {
    const snapshot = body as {
      windows?: BoardWindow[];
      connections?: BoardConnection[];
    } | null;

    if (Array.isArray(snapshot?.windows)) {
      setWindows((local) =>
        mergeSnapshot(
          snapshot.windows!,
          local,
          pendingWindows.current,
          pendingNotes.current,
          tombstones.current
        )
      );
    }

    if (Array.isArray(snapshot?.connections)) {
      setConnections(
        mergeConnections(snapshot.connections, connectionTombstones.current)
      );
    }
  }, []);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const response = await fetch(base, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return;

      applySnapshot(await response.json());
    } catch {
      // Abort ou rede fora: a lousa mantém o último estado bom em vez de
      // piscar vazia. O próximo evento tenta de novo.
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [base, applySnapshot]);

  const scheduleRefresh = useCallback(() => {
    if (burstTimer.current) clearTimeout(burstTimer.current);
    burstTimer.current = setTimeout(refresh, BURST_WINDOW);
  }, [refresh]);

  /* ---------------------------------------------------------------- */
  /* Escrita                                                           */
  /* ---------------------------------------------------------------- */

  const flushWindow = useCallback(
    async (id: string, keepalive = false) => {
      const patch = queuedWindow.current.get(id);
      queuedWindow.current.delete(id);

      const timer = windowTimers.current.get(id);
      if (timer) clearTimeout(timer);
      windowTimers.current.delete(id);

      if (!patch) return;

      try {
        const response = await fetch(`${base}/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
          keepalive,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setError(plainNotice(body?.error ?? "Não foi possível salvar a posição."));
          // A rebusca traz de volta o que o banco realmente tem: melhor a
          // janela pular para o último estado salvo do que ficar mentindo
          // que foi guardada.
          scheduleRefresh();
        }
      } catch {
        setError(plainNotice("Sem conexão. A última mudança não foi salva."));
      } finally {
        pendingWindows.current.delete(id);
      }
    },
    [base, scheduleRefresh]
  );

  const flushNote = useCallback(async (noteId: string, keepalive = false) => {
    const patch = queuedNote.current.get(noteId);
    queuedNote.current.delete(noteId);

    const timer = noteTimers.current.get(noteId);
    if (timer) clearTimeout(timer);
    noteTimers.current.delete(noteId);

    if (!patch) return;

    try {
      const response = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        keepalive,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(plainNotice(body?.error ?? "Não foi possível salvar a nota."));
      }
    } catch {
      setError(plainNotice("Sem conexão. A nota não foi salva."));
    } finally {
      pendingNotes.current.delete(noteId);
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /* Ciclo de vida da sessão da lousa                                  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    /**
     * Descarrega a fila agora, sem esperar o debounce.
     *
     * `keepalive` é o que faz a requisição sobreviver ao fechamento da aba:
     * sem ele o navegador aborta tudo que estiver em voo e a última posição
     * arrastada se perde justamente na hora em que a pessoa sai.
     */
    function flushAll() {
      for (const id of [...queuedWindow.current.keys()]) {
        void flushWindow(id, true);
      }
      for (const id of [...queuedNote.current.keys()]) {
        void flushNote(id, true);
      }
    }

    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // O token vai para o socket antes da assinatura: sem ele a RLS do
    // Realtime descarta todos os eventos, e a lousa deixa de sincronizar
    // entre dispositivos sem dar nenhum sinal. Ver lib/supabase/realtime.ts.
    void (async () => {
      await authorizeRealtime(supabase);
      if (cancelled) return;

      channel = supabase
        .channel(`board:${workspaceId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "workspace_windows" },
          scheduleRefresh
        )
        // As notas também: renomear uma nota noutro dispositivo precisa
        // aparecer no título da janela aqui.
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notes" },
          scheduleRefresh
        )
        // E as ligações: uma flecha desenhada no celular precisa aparecer no
        // monitor sem recarregar a página.
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "workspace_connections" },
          scheduleRefresh
        )
        .subscribe();
    })();

    function handleVisibility() {
      // Voltar para a aba é quando o estado tem mais chance de estar velho:
      // o websocket pode ter caído em segundo plano. Sair é quando a fila
      // tem mais chance de se perder.
      if (document.visibilityState === "visible") scheduleRefresh();
      else flushAll();
    }

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", flushAll);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", flushAll);
      if (burstTimer.current) clearTimeout(burstTimer.current);
      inFlight.current?.abort();
      if (channel) supabase.removeChannel(channel);
      flushAll();
    };
  }, [workspaceId, scheduleRefresh, flushWindow, flushNote]);

  /* ---------------------------------------------------------------- */
  /* Ações                                                             */
  /* ---------------------------------------------------------------- */

  const queueWindow = useCallback(
    (id: string, patch: WindowPatch) => {
      pendingWindows.current.add(id);
      queuedWindow.current.set(id, {
        ...queuedWindow.current.get(id),
        ...patch,
      });

      const existing = windowTimers.current.get(id);
      if (existing) clearTimeout(existing);
      windowTimers.current.set(
        id,
        setTimeout(() => void flushWindow(id), COMMIT_DELAY)
      );
    },
    [flushWindow]
  );

  /**
   * Move, redimensiona ou reestila uma janela.
   *
   * O estado local muda na hora — é ele que o arraste desenha. A escrita
   * espera; chamadas seguidas sobre a mesma janela substituem a anterior na
   * fila, então soltar e mexer de novo continua custando uma requisição só.
   */
  const updateWindow = useCallback(
    (id: string, patch: WindowPatch, { persist = true } = {}) => {
      setWindows((current) =>
        current.map((item) => (item.id === id ? applyPatch(item, patch) : item))
      );

      if (persist) queueWindow(id, patch);
    },
    [queueWindow]
  );

  /** Edita a nota que uma janela mostra. */
  const updateNote = useCallback(
    (noteId: string, patch: NotePatch) => {
      setWindows((current) =>
        current.map((item) =>
          item.note && item.note.id === noteId
            ? { ...item, note: { ...item.note, ...patch } }
            : item
        )
      );

      pendingNotes.current.add(noteId);
      queuedNote.current.set(noteId, {
        ...queuedNote.current.get(noteId),
        ...patch,
      });

      const existing = noteTimers.current.get(noteId);
      if (existing) clearTimeout(existing);
      noteTimers.current.set(
        noteId,
        setTimeout(() => void flushNote(noteId), NOTE_SAVE_DELAY)
      );
    },
    [flushNote]
  );

  /** Muda as tags da nota em todas as janelas que a mostram. */
  const patchNoteTags = useCallback(
    (noteId: string, next: (tags: BoardNoteTag[]) => BoardNoteTag[]) => {
      setWindows((current) =>
        current.map((item) =>
          item.note && item.note.id === noteId
            ? { ...item, note: { ...item.note, tags: next(item.note.tags) } }
            : item
        )
      );
    },
    []
  );

  /**
   * Marca a nota com uma tag, direto da janela da lousa.
   *
   * Otimista: o chip entra na hora, com a cor derivada do nome, e um id
   * provisório. A resposta traz o id (e a cor) de verdade, e o chip é
   * reconciliado. `pendingNotes` protege a mudança de um retrato que chegue
   * no meio do caminho — mesma mecânica do texto da nota.
   */
  const addNoteTag = useCallback(
    async (noteId: string, rawName: string) => {
      const name = rawName.trim().toLowerCase().replace(/\s+/g, " ");
      if (!name) return;

      const current = latest.current
        .find((item) => item.note?.id === noteId)
        ?.note?.tags;
      if (current?.some((tag) => tag.name === name)) return;

      const tempId = `pending:${name}`;
      pendingNotes.current.add(noteId);
      patchNoteTags(noteId, (tags) => [
        ...tags,
        { id: tempId, name, color: paletteFromName(name) },
      ]);

      try {
        const response = await fetch(`/api/notes/${noteId}/tags`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const body = await response.json().catch(() => null);

        if (!response.ok) {
          patchNoteTags(noteId, (tags) =>
            tags.filter((tag) => tag.id !== tempId)
          );
          setError(plainNotice(body?.error ?? "Não foi possível marcar a tag."));
          return;
        }

        // Troca o chip provisório pelo real; se o servidor devolveu uma tag
        // que já estava lá, o provisório simplesmente sai.
        patchNoteTags(noteId, (tags) => {
          const withoutTemp = tags.filter((tag) => tag.id !== tempId);
          return withoutTemp.some((tag) => tag.id === body.tag.id)
            ? withoutTemp
            : [...withoutTemp, body.tag];
        });
      } catch {
        patchNoteTags(noteId, (tags) => tags.filter((tag) => tag.id !== tempId));
        setError(plainNotice("Sem conexão. A tag não foi marcada."));
      } finally {
        if (!queuedNote.current.has(noteId)) pendingNotes.current.delete(noteId);
      }
    },
    [patchNoteTags]
  );

  /** Tira uma tag da nota. */
  const removeNoteTag = useCallback(
    async (noteId: string, tagId: string) => {
      const removed = latest.current
        .find((item) => item.note?.id === noteId)
        ?.note?.tags.find((tag) => tag.id === tagId);
      if (!removed) return;

      pendingNotes.current.add(noteId);
      patchNoteTags(noteId, (tags) => tags.filter((tag) => tag.id !== tagId));

      try {
        const response = await fetch(
          `/api/notes/${noteId}/tags?tagId=${tagId}`,
          { method: "DELETE" }
        );
        if (!response.ok) {
          patchNoteTags(noteId, (tags) =>
            tags.some((tag) => tag.id === tagId) ? tags : [...tags, removed]
          );
          setError(plainNotice("Não foi possível remover a tag."));
        }
      } catch {
        patchNoteTags(noteId, (tags) =>
          tags.some((tag) => tag.id === tagId) ? tags : [...tags, removed]
        );
        setError(plainNotice("Sem conexão. A tag não foi removida."));
      } finally {
        if (!queuedNote.current.has(noteId)) pendingNotes.current.delete(noteId);
      }
    },
    [patchNoteTags]
  );

  /**
   * Renomeia ou recolore uma tag — em todo lugar de uma vez.
   *
   * A tag é da conta, não da nota: a mesma etiqueta pode estar em cinco
   * janelas abertas, e mudar só a que a pessoa clicou deixaria a lousa
   * mostrando dois nomes para a mesma coisa até a próxima rebusca. Por isso o
   * otimismo varre todas as notas, e não uma.
   *
   * `pendingNotes` fica de fora aqui de propósito: quem escreve tag não é a
   * rota da nota, e marcar a nota como "em voo" faria um retrato do servidor
   * preservar o texto local por engano.
   */
  const updateTag = useCallback(
    async (tagId: string, patch: { name?: string; color?: string | null }) => {
      const name =
        patch.name === undefined
          ? undefined
          : patch.name.trim().toLowerCase().replace(/\s+/g, " ");
      if (name !== undefined && name.length === 0) return;

      const before = latest.current
        .flatMap((item) => item.note?.tags ?? [])
        .find((tag) => tag.id === tagId);
      if (!before) return;

      const after = {
        ...before,
        ...(name !== undefined && { name }),
        ...(patch.color !== undefined && { color: patch.color }),
      };
      if (after.name === before.name && after.color === before.color) return;

      const paint = (value: BoardNoteTag) =>
        setWindows((current) =>
          current.map((item) =>
            item.note?.tags.some((tag) => tag.id === tagId)
              ? {
                  ...item,
                  note: {
                    ...item.note,
                    tags: item.note.tags.map((tag) =>
                      tag.id === tagId ? value : tag
                    ),
                  },
                }
              : item
          )
        );

      paint(after);

      try {
        const response = await fetch(`/api/tags/${tagId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(name !== undefined && { name }),
            ...(patch.color !== undefined && { color: patch.color }),
          }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setError(plainNotice(body?.error ?? "Não foi possível salvar a tag."));
          paint(before);
        }
      } catch {
        setError(plainNotice("Sem conexão. A tag não foi salva."));
        paint(before);
      }
    },
    []
  );

  /**
   * Traz a janela para a frente.
   *
   * Só a janela clicada é escrita — renumerar a pilha inteira custaria uma
   * requisição por janela a cada clique. O topo atual fica em refs porque
   * ele é derivado do estado, não estado: guardá-lo assim deixa a decisão
   * ("já está na frente? então não faz nada") acontecer fora do atualizador
   * de estado, que precisa continuar puro.
   */
  const topZ = useRef(maxZ(initial));
  const topId = useRef<string | null>(null);

  useEffect(() => {
    topZ.current = Math.max(topZ.current, maxZ(windows));
    latest.current = windows;
  }, [windows]);

  useEffect(() => {
    latestConnections.current = connections;
  }, [connections]);

  const bringToFront = useCallback(
    (id: string) => {
      // Clicar de novo na janela que já está na frente não gera escrita.
      if (topId.current === id) return;
      topId.current = id;

      const next = topZ.current + 1;
      topZ.current = next;

      setWindows((current) =>
        current.map((item) =>
          item.id === id ? { ...item, zIndex: next } : item
        )
      );
      queueWindow(id, { zIndex: next });
    },
    [queueWindow]
  );

  const createWindow = useCallback(
    async (input: CreateWindowInput): Promise<string | null> => {
      try {
        const response = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          // O único ponto da lousa que pode esbarrar em teto de plano: o de
          // elementos e, quando a janela cria uma nota nova, o de capturas.
          setError(
            await readApiFailure(response, "Não foi possível abrir a janela.")
          );
          return null;
        }

        // A rota devolve a lousa inteira relida, não a linha criada: o
        // cliente aplica um retrato consistente em vez de montar o objeto
        // por conta própria e divergir do servidor.
        const body = await response.json().catch(() => null);
        applySnapshot(body);
        return body?.windowId ?? null;
      } catch {
        setError(plainNotice("Sem conexão. A janela não foi criada."));
        return null;
      }
    },
    [base, applySnapshot]
  );

  /**
   * Fecha a janela.
   *
   * Fechar não é apagar: a nota continua na conta e continua achável pela
   * busca. Some da lousa antes de a resposta chegar — se a rota falhar, a
   * rebusca traz a janela de volta.
   */
  const closeWindow = useCallback(
    async (id: string) => {
      queuedWindow.current.delete(id);
      pendingWindows.current.delete(id);
      const timer = windowTimers.current.get(id);
      if (timer) clearTimeout(timer);
      windowTimers.current.delete(id);

      tombstones.current.add(id);
      setWindows((current) => current.filter((item) => item.id !== id));

      try {
        const response = await fetch(`${base}/${id}`, { method: "DELETE" });
        if (!response.ok) {
          setError(plainNotice("Não foi possível fechar a janela."));
          scheduleRefresh();
        }
      } catch {
        setError(plainNotice("Sem conexão. A janela não foi fechada."));
        scheduleRefresh();
      }
    },
    [base, scheduleRefresh]
  );

  /**
   * A borracha.
   *
   * Recebe o que a passada encostou — janelas, flechas, ou os dois. `"all"`
   * em qualquer um dos dois lados significa "tudo o que houver".
   *
   * As duas rotas vão em paralelo, porque nenhuma depende da outra, e o que
   * volta delas vira **um** lote de desfazer. Apagar uma janela já leva as
   * flechas dela por cascade no banco; a rota das ligações existe para a
   * flecha que a borracha encostou sem encostar em janela nenhuma.
   *
   * Tudo some da tela na hora e nada é escrito durante o gesto: uma
   * requisição por rota quando a pessoa solta, no mesmo princípio do
   * arraste.
   */
  const erase = useCallback(
    async (target: EraseTarget) => {
      const windowIds =
        target.windows === "all"
          ? latest.current.map((item) => item.id)
          : (target.windows ?? []);
      const connectionIds =
        target.connections === "all"
          ? latestConnections.current.map((item) => item.id)
          : (target.connections ?? []);

      const clearingWindows = target.windows === "all" || windowIds.length > 0;
      const clearingConnections =
        target.connections === "all" || connectionIds.length > 0;
      if (!clearingWindows && !clearingConnections) return;

      const doomed = new Set(windowIds);

      for (const id of windowIds) {
        // O que estava na fila para estas janelas não tem mais para onde ir.
        queuedWindow.current.delete(id);
        pendingWindows.current.delete(id);
        const timer = windowTimers.current.get(id);
        if (timer) clearTimeout(timer);
        windowTimers.current.delete(id);
        tombstones.current.add(id);
      }
      for (const id of connectionIds) connectionTombstones.current.add(id);

      setWindows((current) => current.filter((item) => !doomed.has(item.id)));
      // As flechas da janela apagada somem junto, aqui como no banco. Sem
      // isto elas ficariam apontando para o vazio até a resposta chegar.
      const goneLinks = new Set(connectionIds);
      setConnections((current) =>
        current.filter(
          (item) =>
            !goneLinks.has(item.id) &&
            !doomed.has(item.fromWindowId) &&
            !doomed.has(item.toWindowId)
        )
      );

      const revive = (ids: string[], set: Set<string>) => {
        for (const id of ids) set.delete(id);
      };

      try {
        const [fromWindows, fromConnections] = await Promise.all([
          clearingWindows
            ? readBody(
                fetch(base, {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(
                    target.windows === "all" ? {} : { ids: windowIds }
                  ),
                })
              )
            : null,
          clearingConnections
            ? readBody(
                fetch(connectionsBase, {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(
                    target.connections === "all" ? {} : { ids: connectionIds }
                  ),
                })
              )
            : null,
        ]);

        if (fromWindows?.failed || fromConnections?.failed) {
          // Apagar nunca esbarra em teto de plano — só em rede e em servidor.
          setError(
            plainNotice(
              fromWindows?.body?.error ??
                fromConnections?.body?.error ??
                "Não foi possível apagar."
            )
          );
          // As lápides saem: o que não foi apagado no banco precisa voltar
          // para a tela na próxima rebusca.
          revive(windowIds, tombstones.current);
          revive(connectionIds, connectionTombstones.current);
          scheduleRefresh();
          return;
        }

        // A rota das janelas devolve os dois lados do retrato; a das
        // ligações, só o dela — e é a mais nova das duas quando as duas
        // rodaram, porque ela viu o cascade já aplicado.
        applySnapshot(fromWindows?.body);
        applySnapshot(fromConnections?.body);

        const removedWindows = fromWindows?.body?.restorable ?? [];
        const removedLinks = dedupeLinks([
          ...(fromWindows?.body?.restorableConnections ?? []),
          ...(fromConnections?.body?.restorableConnections ?? []),
        ]);

        // Nada saiu de verdade — outro dispositivo já tinha apagado. Um
        // cartão dizendo "0 elementos saíram" com um Desfazer que não desfaz
        // nada é pior que cartão nenhum.
        if (removedWindows.length === 0 && removedLinks.length === 0) {
          setLastErased(null);
          return;
        }

        setLastErased({
          removed: removedWindows.length,
          destroyed: removedWindows.filter(
            (row) => row.kind === "sticky" || row.kind === "text"
          ).length,
          connections: removedLinks.length,
          windows: removedWindows,
          links: removedLinks,
        });
      } catch {
        setError(plainNotice("Sem conexão. Nada foi apagado."));
        revive(windowIds, tombstones.current);
        revive(connectionIds, connectionTombstones.current);
        scheduleRefresh();
      }
    },
    [base, connectionsBase, scheduleRefresh, applySnapshot]
  );

  /**
   * Desfaz a última apagada.
   *
   * Janelas e flechas na mesma requisição, e nesta ordem no servidor: uma
   * flecha precisa das duas pontas de pé para entrar. As janelas voltam com
   * o id que tinham, e é justamente isso que permite as flechas
   * reencontrá-las.
   */
  const undoErase = useCallback(async () => {
    if (!lastErased) return;
    const batch = lastErased;
    setLastErased(null);

    try {
      const response = await fetch(`${base}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          windows: batch.windows,
          connections: batch.links,
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(plainNotice(body?.error ?? "Não foi possível restaurar."));
        // O cartão volta: a pessoa tenta de novo em vez de perder o lote.
        setLastErased(batch);
        return;
      }

      // Restaurar é o oposto de apagar: as lápides destas linhas não valem
      // mais, e mantê-las esconderia da tela justamente o que voltou.
      for (const row of batch.windows) tombstones.current.delete(row.id);
      connectionTombstones.current.clear();

      applySnapshot(body);
    } catch {
      setError(plainNotice("Sem conexão. Nada foi restaurado."));
      setLastErased(batch);
    }
  }, [base, lastErased, applySnapshot]);

  const dismissErased = useCallback(() => setLastErased(null), []);

  /**
   * Liga dois elementos.
   *
   * Sem otimismo: a flecha aparece quando o servidor confirma. O id dela vem
   * de lá, e desenhar uma com id inventado obrigaria a reconciliá-la com a
   * de verdade depois — inclusive quando a criação falha porque a ligação já
   * existia ou porque a lousa chegou ao teto.
   */
  const connect = useCallback(
    async (fromWindowId: string, toWindowId: string): Promise<boolean> => {
      if (fromWindowId === toWindowId) return false;

      // Ligar de novo o que já está ligado não é erro nem pedido: é o segundo
      // toque de quem clicou duas vezes, ou o encadeamento passando por um
      // par que já existe. Sem esta guarda, o servidor respondia 409 e a
      // lousa mostrava "Essas duas coisas já estão ligadas" com cara de falha
      // — um aviso sobre um estado que já é o desejado.
      const already = latestConnections.current.some(
        (item) =>
          item.fromWindowId === fromWindowId && item.toWindowId === toWindowId
      );
      if (already) return true;

      // A mesma corrida, dentro de um quadro: dois toques rápidos disparam
      // dois POST antes de o primeiro voltar, e o espelho ainda não tem a
      // linha. A trava vive até a resposta chegar.
      const pair = `${fromWindowId}>${toWindowId}`;
      if (connecting.current.has(pair)) return false;
      connecting.current.add(pair);

      try {
        const response = await fetch(connectionsBase, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromWindowId, toWindowId }),
        });

        const body = await response.json().catch(() => null);
        if (!response.ok) {
          // 409 aqui só sai por duplicata, e duplicata já é o estado que a
          // pessoa queria: a rebusca traz a flecha que existe e ninguém
          // precisa ler um aviso sobre isso.
          if (response.status === 409) scheduleRefresh();
          else setError(plainNotice(body?.error ?? "Não foi possível ligar."));
          return response.status === 409;
        }

        applySnapshot(body);
        return true;
      } catch {
        setError(plainNotice("Sem conexão. A ligação não foi criada."));
        return false;
      } finally {
        connecting.current.delete(pair);
      }
    },
    [connectionsBase, applySnapshot, scheduleRefresh]
  );

  /**
   * Escreve — ou apaga — o texto de uma flecha.
   *
   * Otimista, ao contrário da criação: aqui o id já existe e não há nada para
   * reconciliar. O texto entra na hora e volta ao que era se a rota recusar,
   * mesmo padrão do renomear de workspace.
   */
  const renameConnection = useCallback(
    async (connectionId: string, rawLabel: string) => {
      const label = rawLabel.replace(/\s+/g, " ").trim();
      const previous =
        latestConnections.current.find((item) => item.id === connectionId)
          ?.label ?? null;
      const next = label.length === 0 ? null : label;
      if (previous === next) return;

      setConnections((current) =>
        current.map((item) =>
          item.id === connectionId ? { ...item, label: next } : item
        )
      );

      try {
        const response = await fetch(`${connectionsBase}/${connectionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: next }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setError(
            plainNotice(body?.error ?? "Não foi possível salvar o texto.")
          );
          setConnections((current) =>
            current.map((item) =>
              item.id === connectionId ? { ...item, label: previous } : item
            )
          );
        }
      } catch {
        setError(plainNotice("Sem conexão. O texto da ligação não foi salvo."));
        setConnections((current) =>
          current.map((item) =>
            item.id === connectionId ? { ...item, label: previous } : item
          )
        );
      }
    },
    [connectionsBase]
  );


  /**
   * Exclui a nota que uma janela mostra.
   *
   * Diferente de fechar: aqui a nota sai da conta inteira. A rota faz
   * exclusão lógica e remove as janelas dela em qualquer lousa, então a
   * remoção local abaixo cobre todas — não só a que a pessoa clicou.
   */
  const deleteNote = useCallback(
    async (noteId: string) => {
      queuedNote.current.delete(noteId);
      pendingNotes.current.delete(noteId);
      const timer = noteTimers.current.get(noteId);
      if (timer) clearTimeout(timer);
      noteTimers.current.delete(noteId);

      setWindows((current) => {
        for (const item of current) {
          if (item.noteId === noteId) tombstones.current.add(item.id);
        }
        return current.filter((item) => item.noteId !== noteId);
      });

      try {
        const response = await fetch(`/api/notes/${noteId}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          setError(plainNotice("Não foi possível excluir a nota."));
          scheduleRefresh();
        }
      } catch {
        setError(plainNotice("Sem conexão. A nota não foi excluída."));
        scheduleRefresh();
      }
    },
    [scheduleRefresh]
  );

  const dismissError = useCallback(() => setError(null), []);

  return {
    windows,
    error,
    dismissError,
    updateWindow,
    updateNote,
    addNoteTag,
    removeNoteTag,
    updateTag,
    bringToFront,
    createWindow,
    closeWindow,
    connections,
    connect,
    renameConnection,
    erase,
    lastErased,
    undoErase,
    dismissErased,
    deleteNote,
    refresh,
  };
}

/* ---------------------------------------------------------------------- */

/**
 * Lê a resposta sem deixar um corpo malformado virar exceção.
 *
 * A borracha dispara duas rotas em paralelo e precisa saber qual das duas
 * falhou; um `await response.json()` cru numa resposta vazia derrubaria as
 * duas de uma vez.
 */
interface EraseResponse {
  error?: string;
  restorable?: RestorableWindow[];
  restorableConnections?: RestorableConnection[];
  windows?: BoardWindow[];
  connections?: BoardConnection[];
}

async function readBody(
  request: Promise<Response>
): Promise<{ failed: boolean; body: EraseResponse | null }> {
  const response = await request;
  const body = (await response
    .json()
    .catch(() => null)) as EraseResponse | null;
  return { failed: !response.ok, body };
}

/**
 * Uma flecha por par.
 *
 * As duas rotas podem devolver a mesma linha: apagar a janela leva a flecha
 * por cascade, e a passada que encostou nas duas coisas pediu as duas
 * remoções. Restaurar em duplicata cairia no índice único de qualquer forma,
 * mas o número no cartão ficaria errado.
 */
function dedupeLinks(links: RestorableConnection[]): RestorableConnection[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.fromWindowId}>${link.toWindowId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function maxZ(items: BoardWindow[]): number {
  return items.reduce((max, item) => Math.max(max, item.zIndex), 0);
}

function applyPatch(window: BoardWindow, patch: WindowPatch): BoardWindow {
  const { text, tone, backgroundTone, textTone, ...geometry } = patch;

  const next: BoardWindow = { ...window, ...geometry };

  if (
    text !== undefined ||
    tone !== undefined ||
    backgroundTone !== undefined ||
    textTone !== undefined
  ) {
    next.content = {
      text: text ?? window.content?.text ?? "",
      tone: tone ?? window.content?.tone ?? "1",
      backgroundTone:
        backgroundTone ?? window.content?.backgroundTone ?? "none",
      textTone: textTone ?? window.content?.textTone ?? "default",
    };
  }

  return next;
}

/**
 * As flechas do servidor, menos as que esta tela acabou de remover.
 *
 * Mesma corrida das janelas, e mesma lápide: o Realtime dispara a rebusca
 * antes de o DELETE chegar ao banco, e sem isto a flecha reaparece na tela.
 * A lápide sai quando um retrato chega já sem a linha.
 */
function mergeConnections(
  snapshot: BoardConnection[],
  tombstones: Set<string>
): BoardConnection[] {
  if (tombstones.size === 0) return snapshot;

  const present = new Set(snapshot.map((item) => item.id));
  for (const id of [...tombstones]) {
    if (!present.has(id)) tombstones.delete(id);
  }

  return snapshot.filter((item) => !tombstones.has(item.id));
}

/**
 * O retrato do servidor vence, exceto onde existe alteração local em voo.
 *
 * Uma janela sendo arrastada agora, ou uma nota sendo digitada agora, não
 * pode ser sobrescrita por uma resposta que saiu do banco antes de a mudança
 * chegar lá. Fora dessas, o servidor manda — inclusive para remover janelas
 * que outro dispositivo fechou.
 */
function mergeSnapshot(
  snapshot: BoardWindow[],
  local: BoardWindow[],
  pendingWindows: Set<string>,
  pendingNotes: Set<string>,
  tombstones: Set<string>
): BoardWindow[] {
  // Uma lápide vale até o servidor concordar. Quando o retrato chega sem a
  // linha, a remoção está confirmada e a lápide sai — deixá-la para sempre
  // impediria a janela de voltar caso outro dispositivo a recriasse.
  let visible = snapshot;
  if (tombstones.size > 0) {
    const present = new Set(snapshot.map((item) => item.id));
    for (const id of [...tombstones]) {
      if (!present.has(id)) tombstones.delete(id);
    }
    visible = snapshot.filter((item) => !tombstones.has(item.id));
  }

  if (pendingWindows.size === 0 && pendingNotes.size === 0) return visible;

  const byId = new Map(local.map((item) => [item.id, item]));

  return visible.map((item) => {
    const mine = byId.get(item.id);
    if (!mine) return item;

    const keepGeometry = pendingWindows.has(item.id);
    const keepNote = item.note ? pendingNotes.has(item.note.id) : false;
    if (!keepGeometry && !keepNote) return item;

    return {
      ...item,
      ...(keepGeometry && {
        x: mine.x,
        y: mine.y,
        width: mine.width,
        height: mine.height,
        zIndex: mine.zIndex,
        state: mine.state,
        content: mine.content,
      }),
      ...(keepNote && { note: mine.note }),
    };
  });
}
