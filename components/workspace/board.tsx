"use client";

import {
  ArrowLeft,
  ArrowUpToLine,
  Download,
  Eraser,
  ExternalLink,
  FilePlus2,
  Spline,
  FolderInput,
  Maximize,
  Minus,
  Paperclip,
  Pencil,
  Plus,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { NoteTypeIcon } from "@/components/dashboard/note-type-icon";
import { ErrorReport } from "@/components/errors/error-report";
import { UpgradeLink } from "@/components/ui/upgrade-link";
import { AttachmentWindowBody } from "@/components/workspace/attachment-window-body";
import { NotePicker } from "@/components/workspace/note-picker";
import { ToolPropertiesPanel } from "@/components/workspace/tool-properties-panel";
import { ConnectionPropertiesPanel } from "@/components/workspace/connection-properties-panel";
import {
  ElementWindowBody,
  NoteWindowBody,
  TONE_SURFACE,
} from "@/components/workspace/window-bodies";
import { BOARD_GRID, WindowFrame } from "@/components/workspace/window-frame";
import {
  ConnectionLayer,
  PendingConnection,
  connectionAt,
} from "@/components/workspace/connection-layer";
import { ConnectionLabels } from "@/components/workspace/connection-labels";
import {
  DEFAULT_WINDOW_SIZE,
  frameHeightOf,
  frameWidthOf,
} from "@/lib/workspace/window-sizes";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  useBoardWindows,
  type BoardNotice,
  type CreateWindowInput,
  type ErasedBatch,
} from "@/hooks/use-board-windows";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  useBoardViewport,
} from "@/hooks/use-board-viewport";
import type {
  BoardConnection,
  BoardWindow,
  BoardWorkspace,
  OpenableAttachment,
  OpenableNote,
} from "@/lib/workspace/queries";
import { cn } from "@/lib/utils";

/**
 * A lousa de um workspace.
 *
 * Um plano navegável com janelas em cima. Três camadas de coordenadas
 * convivem aqui, e vale nomeá-las porque quase todo bug de canvas caseiro
 * vem de confundi-las:
 *
 *   - **tela**: o que o ponteiro reporta (`clientX`);
 *   - **contêiner**: tela menos a posição da moldura da lousa;
 *   - **lousa**: contêiner menos o pan, dividido pelo zoom. É onde as
 *     janelas moram, e é o que vai para o banco.
 *
 * As janelas são DOM e não canvas de propósito. Elas contêm texto que a
 * pessoa edita: num `<canvas>` seria preciso reimplementar seleção, cursor,
 * desfazer, corretor, teclado de celular e leitor de tela — e o resultado
 * seria pior em todos eles. Se a contagem de janelas crescer a ponto de
 * pesar, o caminho é virtualizar por viewport, não trocar de tecnologia.
 */

/** Espaçamento do grid de pontos do fundo, em pixels de lousa. */
const DOT_SPACING = 24;
/**
 * Quanto os botões e os atalhos mexem no zoom, por acionamento.
 *
 * Proporcional, e não um número fixo somado: 20 pontos percentuais somados a
 * 160% é um retoque, e os mesmos 20 subtraídos de 40% é quase metade do que
 * se estava vendo. Multiplicar dá o mesmo salto aparente em qualquer altura
 * da escala — 100 → 125 → 156 subindo, 100 → 80 → 64 descendo.
 */
const ZOOM_STEP = 1.25;
/** Conjunto vazio compartilhado. Nunca é mutado — a passada cria um novo. */
const EMPTY_SET: ReadonlySet<string> = new Set();

interface BoardProps {
  workspace: BoardWorkspace;
  initialWindows: BoardWindow[];
  /** As flechas, já lidas junto com as janelas. Ver o comentário da página. */
  initialConnections: BoardConnection[];
  /**
   * Janela em que a lousa deve chegar centralizada.
   *
   * Vem de quem abriu uma nota aqui de fora — do dashboard ou do editor.
   * Sem isso, a janela nova entra abaixo do arranjo e a pessoa chega numa
   * lousa que parece não ter mudado nada.
   */
  focusWindowId: string | null;
  /** Teto de elementos do plano, só para a mensagem quando ele é atingido. */
  windowCap: number;
  /**
   * Assinar resolveria o teto desta pessoa?
   *
   * No Gratuito, sim: o teto que ela encontra é o do plano. No Pro o teto é o
   * absoluto (anti-abuso, igual para todos), e oferecer o Pro a quem já paga
   * é a interface não saber com quem está falando.
   */
  canUpgrade: boolean;
}

export function Board({
  workspace,
  initialWindows,
  initialConnections,
  focusWindowId,
  windowCap,
  canUpgrade,
}: BoardProps) {
  const { viewport, restored, toBoard, zoomTo, panBy, fitTo } =
    useBoardViewport(workspace.id);
  const {
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
    updateConnection,
    erase,
    lastErased,
    undoErase,
    dismissErased,
    deleteNote,
  } = useBoardWindows(workspace.id, initialWindows, initialConnections);

  const router = useRouter();

  // Chegando apontada para uma janela, ela já nasce em destaque — em vez de
  // um efeito mexer nisso depois do primeiro paint.
  const [focusedId, setFocusedId] = useState<string | null>(focusWindowId);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Criar uma janela é uma ida ao servidor. Enquanto ela não volta, os
  // botões saem do ar — sem isso o botão continua com o foco do teclado, e
  // a barra de espaço de quem já começou a digitar o aciona de novo.
  const [creating, setCreating] = useState(false);
  /**
   * A ferramenta na mão.
   *
   * Um estado só, e não um booleano por ferramenta: borracha e ligação
   * disputam o mesmo gesto — passar o ponteiro por cima das janelas — e duas
   * bandeiras independentes deixariam as duas ligadas ao mesmo tempo, com o
   * primeiro clique fazendo as duas coisas.
   *
   * As duas trabalham por uma camada por cima do plano, que recebe o ponteiro
   * no lugar das janelas. Quem decide o que está embaixo é a conta de
   * `windowAt` e `connectionAt`, não o DOM — a camada responderia sempre por
   * ela mesma.
   */
  const [tool, setTool] = useState<"none" | "eraser" | "link">("none");
  /**
   * O que a passada da borracha já encostou.
   *
   * Some da tela na hora, mas nada é escrito até a pessoa soltar: um gesto,
   * uma requisição, no mesmo princípio do arraste.
   */
  const [swept, setSwept] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [sweptLinks, setSweptLinks] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [underEraser, setUnderEraser] = useState<string | null>(null);
  const [underEraserLink, setUnderEraserLink] = useState<string | null>(null);
  const [armedClear, setArmedClear] = useState(false);
  /** De onde a ligação em curso sai, e onde o ponteiro está agora. */
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [linkingPending, setLinkingPending] = useState(false);
  const linkSession = useRef(0);
  /** A flecha com o campo de rótulo aberto. */
  const [labelingId, setLabelingId] = useState<string | null>(null);
  /**
   * A flecha aberta no inspetor.
   *
   * Exclusiva com a janela focada: os dois inspetores ocupam o mesmo lugar, e
   * quem seleciona uma coisa está desistindo da outra.
   */
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [pointerAt, setPointerAt] = useState<{ x: number; y: number } | null>(
    null
  );
  const linkPointerFrame = useRef<number | null>(null);
  const pendingLinkPointer = useRef<{ x: number; y: number } | null>(null);
  // A fonte da verdade da passada em andamento. O estado acima é o reflexo
  // dela para o React desenhar — quem lê no meio do gesto lê daqui, e assim
  // nenhum atualizador de estado precisa deixar de ser puro.
  const sweptRef = useRef<ReadonlySet<string>>(EMPTY_SET);
  const sweptLinksRef = useRef<ReadonlySet<string>>(EMPTY_SET);
  const sweeping = useRef(false);
  /**
   * Onde o último botão direito (ou toque longo) aconteceu, em coordenadas
   * da lousa.
   *
   * O Radix posiciona o menu sozinho, mas não sabe o que "aqui" significa
   * numa superfície com pan e zoom — isso é conta nossa, e é a diferença
   * entre este menu e a barra de ferramentas, que cria no centro da tela.
   */
  const spawnAt = useRef<{ x: number; y: number } | null>(null);

  /**
   * O nome do workspace, editável aqui mesmo.
   *
   * Ele vem do servidor, mas vive em estado local a partir daí: quem
   * renomeia está olhando para o nome, e esperar uma ida ao servidor para o
   * título mudar faria a interface parecer que o clique não pegou. Se a rota
   * recusar, o nome volta ao que era e o aviso explica.
   */
  const [name, setName] = useState(workspace.name);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) return;
    renameRef.current?.focus();
    renameRef.current?.select();
  }, [renaming]);

  const commitRename = useCallback(
    async (raw: string) => {
      setRenaming(false);
      const next = raw.trim();
      if (!next || next === name) return;

      const previous = name;
      setName(next);
      setRenameError(null);

      try {
        const response = await fetch(`/api/workspaces/${workspace.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: next }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setName(previous);
          setRenameError(body?.error ?? "Não foi possível renomear.");
        }
      } catch {
        setName(previous);
        setRenameError("Sem conexão. O nome não mudou.");
      }
    },
    [name, workspace.id]
  );

  const frameRef = useRef<HTMLDivElement>(null);
  // Ponteiros ativos sobre o fundo. Um = arrastar a lousa; dois = pinça.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  /* ---------------------------------------------------------------- */
  /* Navegação da lousa                                                */
  /* ---------------------------------------------------------------- */

  /** Coordenadas de contêiner, que é o referencial do pan e do zoom. */
  const toContainer = useCallback((clientX: number, clientY: number) => {
    const box = frameRef.current?.getBoundingClientRect();
    return {
      x: clientX - (box?.left ?? 0),
      y: clientY - (box?.top ?? 0),
    };
  }, []);

  /**
   * Roda e atalhos, instalados à mão.
   *
   * `onWheel` do React não serve aqui: o React registra o ouvinte de
   * `wheel` na raiz como **passivo**, e num ouvinte passivo
   * `preventDefault` não faz nada. Era exatamente o que acontecia —
   * Ctrl+roda ampliava a lousa **e** a página do navegador junto, cada uma
   * por sua conta, e ninguém conseguia mirar em nada.
   *
   * Três regras, nesta ordem:
   *
   *  - Com Ctrl (ou ⌘), é zoom da lousa, e o navegador não vê o evento.
   *  - Vindo de dentro de uma janela, o evento é dela: um PDF de vinte
   *    páginas ou uma nota mais alta que a janela precisam rolar sem
   *    arrastar o plano inteiro junto.
   *  - No fundo, desloca o plano.
   */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    function handleWheel(event: WheelEvent) {
      const box = frame!.getBoundingClientRect();

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomTo(
          (current) => current * wheelZoomFactor(event),
          event.clientX - box.left,
          event.clientY - box.top
        );
        return;
      }

      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-board-window]") !== null
      ) {
        return;
      }

      event.preventDefault();
      const delta = wheelPixels(event);
      panBy(-delta.x, -delta.y);
    }

    frame.addEventListener("wheel", handleWheel, { passive: false });
    return () => frame.removeEventListener("wheel", handleWheel);
  }, [zoomTo, panBy]);

  /**
   * Ctrl com "+", "−" e "0" amplia a lousa, não a página.
   *
   * Numa superfície que tem zoom próprio, o zoom do navegador é a resposta
   * errada para o gesto certo: ele estica a barra de ferramentas junto, não
   * muda o que cabe no plano e se perde no recarregamento. Estes três
   * atalhos passam a mexer na lousa; o resto do navegador continua como
   * está.
   */
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      const box = frameRef.current?.getBoundingClientRect();
      const x = (box?.width ?? 0) / 2;
      const y = (box?.height ?? 0) / 2;

      // `code` além de `key`: com Ctrl, o "+" do teclado numérico e o "="
      // da fileira de números chegam com nomes diferentes conforme o layout,
      // e um teclado ABNT2 ainda manda um terceiro.
      if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") {
        event.preventDefault();
        zoomTo((current) => current * ZOOM_STEP, x, y);
        return;
      }

      if (
        event.key === "-" ||
        event.key === "_" ||
        event.code === "NumpadSubtract"
      ) {
        event.preventDefault();
        zoomTo((current) => current / ZOOM_STEP, x, y);
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        zoomTo(1, x, y);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [zoomTo]);

  const recordSpawnPoint = useCallback(
    (clientX: number, clientY: number) => {
      const point = toContainer(clientX, clientY);
      const at = toBoard(point.x, point.y);
      spawnAt.current = { x: snapToGrid(at.x), y: snapToGrid(at.y) };
    },
    [toContainer, toBoard]
  );

  const handleBackgroundPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Só o fundo arrasta a lousa. Um `pointerdown` que veio de dentro de
      // uma janela já foi tratado lá e não pode virar pan.
      if (event.target !== event.currentTarget) return;

      setFocusedId(null);
      setSelectedLinkId(null);
      recordSpawnPoint(event.clientX, event.clientY);
      event.currentTarget.setPointerCapture(event.pointerId);
      pointers.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });

      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinch.current = {
          distance: distanceBetween(a, b),
          zoom: viewport.zoom,
        };
      }
    },
    [viewport.zoom, recordSpawnPoint]
  );

  const handleBackgroundPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const previous = pointers.current.get(event.pointerId);
      if (!previous) return;

      const next = { x: event.clientX, y: event.clientY };
      pointers.current.set(event.pointerId, next);

      if (pointers.current.size >= 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()];
        const spread = distanceBetween(a, b);
        if (pinch.current.distance > 0) {
          const middle = toContainer((a.x + b.x) / 2, (a.y + b.y) / 2);
          zoomTo(
            (pinch.current.zoom * spread) / pinch.current.distance,
            middle.x,
            middle.y
          );
        }
        return;
      }

      panBy(next.x - previous.x, next.y - previous.y);
    },
    [panBy, zoomTo, toContainer]
  );

  const handleBackgroundPointerUp = useCallback((event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }, []);

  /* ---------------------------------------------------------------- */
  /* Borracha e ligação — as duas ferramentas do ponteiro              */
  /* ---------------------------------------------------------------- */

  /**
   * A janela debaixo do ponteiro.
   *
   * A conta é feita à mão, e não com `elementFromPoint`, por dois motivos: a
   * camada da ferramenta fica **por cima** das janelas — o navegador
   * responderia sempre a ela —, e o retângulo de uma janela recolhida é só a
   * barra de título, que mede 36px e não a altura guardada.
   */
  const windowAt = useCallback(
    (clientX: number, clientY: number): BoardWindow | null => {
      const point = toContainer(clientX, clientY);
      const at = toBoard(point.x, point.y);

      let hit: BoardWindow | null = null;
      for (const item of windows) {
        // O que a passada já encostou não conta mais: ele sumiu da tela, e
        // continuar respondendo por aquele ponto faria a borracha não
        // alcançar o que estava embaixo dele.
        if (sweptRef.current.has(item.id)) continue;

        const inside =
          at.x >= item.x &&
          at.x <= item.x + frameWidthOf(item) &&
          at.y >= item.y &&
          at.y <= item.y + frameHeightOf(item);

        // A de cima ganha: é a que a pessoa está vendo naquele ponto.
        if (inside && (!hit || item.zIndex >= hit.zIndex)) hit = item;
      }

      return hit;
    },
    [windows, toContainer, toBoard]
  );

  /**
   * Uma passada da borracha.
   *
   * A janela vem antes da flecha porque é ela que está por cima na tela:
   * dentro de uma janela, o traço que passa por baixo não é o que a pessoa
   * está mirando.
   */
  const sweep = useCallback(
    (clientX: number, clientY: number) => {
      const hit = windowAt(clientX, clientY);
      setUnderEraser(hit?.id ?? null);

      const container = toContainer(clientX, clientY);
      const at = toBoard(container.x, container.y);
      const link = hit
        ? null
        : connectionAt(at, connections, windows, viewport.zoom);
      setUnderEraserLink(link?.id ?? null);

      if (!sweeping.current) return;

      if (hit && !sweptRef.current.has(hit.id)) {
        const next = new Set(sweptRef.current).add(hit.id);
        sweptRef.current = next;
        setSwept(next);
        return;
      }

      if (link && !sweptLinksRef.current.has(link.id)) {
        const next = new Set(sweptLinksRef.current).add(link.id);
        sweptLinksRef.current = next;
        setSweptLinks(next);
      }
    },
    [windowAt, toContainer, toBoard, connections, windows, viewport.zoom]
  );

  const commitSweep = useCallback(() => {
    sweeping.current = false;

    const windowIds = [...sweptRef.current];
    const linkIds = [...sweptLinksRef.current];
    sweptRef.current = EMPTY_SET;
    sweptLinksRef.current = EMPTY_SET;
    setSwept(EMPTY_SET);
    setSweptLinks(EMPTY_SET);

    if (windowIds.length > 0 || linkIds.length > 0) {
      void erase({ windows: windowIds, connections: linkIds });
    }
  }, [erase]);

  /** Guarda a ferramenta e devolve à lousa o que o gesto ainda não gravou. */
  const stopTool = useCallback(() => {
    linkSession.current += 1;
    sweeping.current = false;
    sweptRef.current = EMPTY_SET;
    sweptLinksRef.current = EMPTY_SET;
    setSwept(EMPTY_SET);
    setSweptLinks(EMPTY_SET);
    setUnderEraser(null);
    setUnderEraserLink(null);
    setArmedClear(false);
    setLinkingFrom(null);
    setLinkingPending(false);
    setPointerAt(null);
    pendingLinkPointer.current = null;
    if (linkPointerFrame.current !== null) {
      cancelAnimationFrame(linkPointerFrame.current);
      linkPointerFrame.current = null;
    }
    setTool("none");
  }, []);

  useEffect(
    () => () => {
      if (linkPointerFrame.current !== null) {
        cancelAnimationFrame(linkPointerFrame.current);
      }
    },
    []
  );

  const trackLinkPointer = useCallback(
    (clientX: number, clientY: number) => {
      const point = toContainer(clientX, clientY);
      pendingLinkPointer.current = toBoard(point.x, point.y);
      if (linkPointerFrame.current !== null) return;

      linkPointerFrame.current = requestAnimationFrame(() => {
        linkPointerFrame.current = null;
        const next = pendingLinkPointer.current;
        pendingLinkPointer.current = null;
        if (next) setPointerAt(next);
      });
    },
    [toBoard, toContainer]
  );

  /**
   * Pega uma ferramenta.
   *
   * Fecha o campo de rótulo no mesmo gesto: com a borracha na mão o que se
   * faz é passar por cima, e um campo de texto aberto no meio disso seria uma
   * segunda conversa por cima da primeira. Um caminho só para as quatro
   * portas de entrada das ferramentas (os dois botões da barra e os dois
   * itens do menu do fundo), para nenhuma delas esquecer disso.
   */
  const pickTool = useCallback((next: "eraser" | "link") => {
    linkSession.current += 1;
    setLabelingId(null);
    setTool(next);
  }, []);

  const clearBoard = useCallback(() => {
    setArmedClear(false);
    // Só as janelas: as flechas caem junto por cascade, no banco.
    void erase({ windows: "all" });
  }, [erase]);

  /**
   * Um toque com a ligação na mão.
   *
   * Dois passos, e não um arraste: escolher a origem e depois o destino
   * funciona igual no mouse e no dedo, e não disputa com o arraste da janela.
   * O segundo toque na mesma janela desiste — é o gesto de quem clicou
   * errado.
   */
  const pickForLink = useCallback(
    async (clientX: number, clientY: number) => {
      if (linkingPending) return;
      const hit = windowAt(clientX, clientY);
      if (!hit) {
        // No vazio, a escolha se desfaz. Sair da ferramenta é o "×" ou o Esc.
        setLinkingFrom(null);
        return;
      }

      // A origem só vale enquanto a janela dela existe. Fechada aqui ou
      // noutro dispositivo, `linkingFrom` continuaria apontando para uma
      // linha que já não está na lousa: a ponta tracejada some (não há de
      // onde sair), a barra segue pedindo o destino, e o toque seguinte
      // gastaria uma ida ao servidor para voltar "Um dos elementos não está
      // nesta lousa". Conferir aqui é conferir na hora em que a resposta
      // importa.
      const origin =
        linkingFrom && windows.some((item) => item.id === linkingFrom)
          ? linkingFrom
          : null;

      if (!origin) {
        setLinkingFrom(hit.id);
        return;
      }

      if (hit.id === origin) {
        setLinkingFrom(null);
        return;
      }

      setLinkingPending(true);
      const session = linkSession.current;
      const created = await connect(origin, hit.id);
      if (session !== linkSession.current) return;
      setLinkingPending(false);
      // Só encadeia depois da confirmação. Antes, a interface avançava de
      // etapa sem a flecha existir e parecia ter ignorado o segundo toque.
      if (created) setLinkingFrom(hit.id);
    },
    [windowAt, linkingFrom, windows, connect, linkingPending]
  );

  // Esc guarda a ferramenta. Um modo sem saída óbvia é um modo em que a
  // pessoa fica presa — e a tecla é a primeira que se tenta.
  useEffect(() => {
    if (tool === "none") return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Com uma ligação em curso, o Esc primeiro desfaz a escolha; só o
      // segundo guarda a ferramenta.
      if (linkingFrom) setLinkingFrom(null);
      else stopTool();
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [tool, linkingFrom, stopTool]);

  /**
   * O que a lousa mostra agora.
   *
   * O que a passada já encostou sai da tela na hora, antes de qualquer
   * requisição — é o que faz a borracha parecer uma borracha. Se a pessoa
   * guardar a ferramenta no meio do gesto, tudo volta.
   */
  const visibleWindows =
    swept.size === 0
      ? windows
      : windows.filter((item) => !swept.has(item.id));

  // As flechas da janela encostada somem junto com ela, aqui como no banco:
  // uma flecha apontando para o vazio seria pior do que nenhuma.
  const visibleConnections =
    swept.size === 0 && sweptLinks.size === 0
      ? connections
      : connections.filter(
          (item) =>
            !sweptLinks.has(item.id) &&
            !swept.has(item.fromWindowId) &&
            !swept.has(item.toWindowId)
        );

  /** A janela que a borracha vai apagar se encostar agora. */
  const eraserTarget =
    underEraser === null
      ? null
      : (visibleWindows.find((item) => item.id === underEraser) ?? null);

  /** A janela de onde a ligação em curso sai. */
  const linkOrigin =
    linkingFrom === null
      ? null
      : (visibleWindows.find((item) => item.id === linkingFrom) ?? null);
  const linkTarget =
    tool !== "link" || underEraser === null
      ? null
      : (visibleWindows.find((item) => item.id === underEraser) ?? null);

  const usingTool = tool !== "none";
  const selectedTextWindow =
    !usingTool && !pickerOpen
      ? (visibleWindows.find(
          (item) => item.id === focusedId && item.kind === "text"
        ) ?? null)
      : null;

  useEffect(() => {
    if (!selectedTextWindow) return;

    function closeProperties(event: KeyboardEvent) {
      if (event.key === "Escape") setFocusedId(null);
    }

    window.addEventListener("keydown", closeProperties);
    return () => window.removeEventListener("keydown", closeProperties);
  }, [selectedTextWindow]);

  /**
   * A flecha do inspetor, **se ela ainda existir** — mesma conta do
   * `editingLabelId` abaixo: apagada noutro dispositivo, o inspetor some em
   * vez de editar uma linha que não está mais lá.
   */
  const selectedConnection =
    !usingTool && !pickerOpen && !selectedTextWindow && selectedLinkId
      ? (visibleConnections.find((item) => item.id === selectedLinkId) ?? null)
      : null;

  function endpointTitle(windowId: string): string {
    const item = windows.find((candidate) => candidate.id === windowId);
    return item ? titleOf(item) : "Elemento";
  }

  const selectConnection = useCallback((id: string) => {
    setFocusedId(null);
    setSelectedLinkId(id);
  }, []);

  useEffect(() => {
    if (!selectedConnection) return;
    const id = selectedConnection.id;

    function handleKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.closest("input, textarea, [contenteditable='true']") != null;

      if (event.key === "Escape" && !typing) {
        setSelectedLinkId(null);
        return;
      }
      // Delete apaga a flecha selecionada, com o mesmo "Desfazer" da
      // borracha. Nunca de dentro de um campo: ali a tecla é do texto.
      if ((event.key === "Delete" || event.key === "Backspace") && !typing) {
        event.preventDefault();
        setSelectedLinkId(null);
        void erase({ connections: [id] });
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedConnection, erase]);

  /**
   * A flecha que está com o campo aberto, **se ela ainda existir**.
   *
   * Derivado em vez de corrigido por efeito: apagar a flecha noutro
   * dispositivo deixaria `labelingId` apontando para uma linha que não está
   * mais na lista, e um campo flutuando sozinho no meio da lousa. Aqui a
   * pergunta é feita na hora de desenhar, que é quando ela tem resposta.
   */
  const editingLabelId =
    labelingId && connections.some((item) => item.id === labelingId)
      ? labelingId
      : null;

  // Identidade estável: é o que faz o `memo` de cada flecha valer alguma
  // coisa. Uma função nova a cada quadro de arraste re-renderizaria todas.
  const removeConnection = useCallback(
    (id: string) => void erase({ connections: [id] }),
    [erase]
  );
  const commitConnectionLabel = useCallback(
    (id: string, label: string) => void renameConnection(id, label),
    [renameConnection]
  );

  /** Retângulo que contém todas as janelas. */
  const bounds = boundsOf(visibleWindows);

  const fitAll = useCallback(() => {
    const box = frameRef.current?.getBoundingClientRect();
    fitTo(bounds, box?.width ?? 0, box?.height ?? 0);
  }, [bounds, fitTo]);

  /**
   * O enquadramento de chegada, decidido uma vez só.
   *
   * Dois casos, um efeito. Chegando apontada para uma janela — quem abriu a
   * nota lá do dashboard ou do editor —, a lousa enquadra **nela**; a janela
   * entrou abaixo do arranjo, e sem isso a pessoa chegaria numa tela que
   * parece não ter mudado nada. Sem alvo, e só quando este dispositivo ainda
   * não tem enquadramento guardado, enquadra o conjunto: é o que impede um
   * celular de abrir uma lousa montada no monitor e mostrar uma superfície
   * vazia com tudo fora da tela.
   *
   * Os dois casos moram no mesmo efeito de propósito. Separados, disputavam
   * a mesma trava e a ordem entre eles passava a importar.
   */
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || windows.length === 0) return;

    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;

    if (focusWindowId) {
      const target = windows.find((item) => item.id === focusWindowId);
      // A janela pode não ter chegado ainda; o próximo retrato tenta de novo.
      if (!target) return;

      framed.current = true;
      fitTo(
        {
          minX: target.x,
          minY: target.y,
          maxX: target.x + target.width,
          maxY: target.y + target.height,
        },
        box.width,
        box.height
      );
      return;
    }

    if (restored !== false) return;
    framed.current = true;
    fitTo(boundsOf(windows), box.width, box.height);
  }, [focusWindowId, restored, windows, fitTo]);

  /* ---------------------------------------------------------------- */
  /* Criação                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Onde uma janela nova aparece: centralizada no que está sendo visto.
   *
   * O deslocamento vem do tamanho **daquele tipo**, não de um número fixo.
   * Um PDF é quase três vezes mais alto que um post-it; centralizado pela
   * medida de uma nota, ele nascia com metade para fora da tela.
   */
  const spawnPoint = useCallback((kind: BoardWindow["kind"]) => {
    const box = frameRef.current?.getBoundingClientRect();
    const center = toBoard((box?.width ?? 800) / 2, (box?.height ?? 600) / 2);
    const size = DEFAULT_WINDOW_SIZE[kind];

    // Um leve deslocamento aleatório para criações seguidas não empilharem
    // exatamente uma sobre a outra e sumirem umas atrás das outras — em
    // múltiplos do grid, para a janela já nascer alinhada.
    const jitter = () => (Math.round(Math.random() * 12) - 6) * BOARD_GRID;

    return {
      x: snapToGrid(center.x - size.width / 2) + jitter(),
      y: snapToGrid(center.y - size.height / 2) + jitter(),
    };
  }, [toBoard]);

  const spawn = useCallback(
    async (
      input: Omit<CreateWindowInput, "x" | "y">,
      at?: { x: number; y: number }
    ) => {
      const point = at ?? spawnPoint(input.kind);
      setCreating(true);
      try {
        const id = await createWindow({ ...input, ...point });
        if (id) {
          setFocusedId(id);
          setJustCreatedId(id);
        }
      } finally {
        setCreating(false);
      }
    },
    [createWindow, spawnPoint]
  );

  const handleBackgroundDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.target !== event.currentTarget) return;

      const point = toContainer(event.clientX, event.clientY);
      const board = toBoard(point.x, point.y);
      spawn(
        { kind: "note", title: "Nova nota" },
        { x: snapToGrid(board.x), y: snapToGrid(board.y) }
      );
    },
    [toContainer, toBoard, spawn]
  );

  const handlePick = useCallback(
    (note: OpenableNote) => {
      setPickerOpen(false);
      spawn({ kind: "note", noteId: note.id });
    },
    [spawn]
  );

  const handlePickAttachment = useCallback(
    (attachment: OpenableAttachment) => {
      setPickerOpen(false);
      spawn({ kind: "attachment", attachmentId: attachment.id });
    },
    [spawn]
  );

  /* ---------------------------------------------------------------- */

  const zoomPercent = Math.round(viewport.zoom * 100);
  const atCap = windows.length >= windowCap;
  // Um lugar só para avisar: dois cartões empilhados no mesmo canto seriam
  // duas conversas ao mesmo tempo.
  //
  // O aviso de teto vem por último porque ele é permanente enquanto a lousa
  // estiver cheia — deixá-lo cobrir um erro de rede esconderia o transitório
  // atrás do constante.
  const notice: BoardNotice | null =
    error ??
    (renameError
      ? { message: renameError, upgrade: false, code: null }
      : null);
  // Só quem tem para onde subir recebe o convite; no Pro o teto é o absoluto.
  const capIsPlanLimit = atCap && canUpgrade;

  return (
    <div className="flex h-[100dvh] flex-col overflow-clip bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2.5 sm:px-4">
        <Link
          href="/dashboard"
          className="flex h-9 shrink-0 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:h-11"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>

        {/* O nome do workspace, e o botão direito que o renomeia.
            O contador ao lado deixou de ser um número solto: "3" não dizia
            nada, e um número sem unidade numa barra de ferramentas é ruído
            que a pessoa aprende a ignorar. */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 transition-colors duration-150 hover:bg-tertiary">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full bg-subtle-foreground"
              />
              {renaming ? (
                <input
                  ref={renameRef}
                  defaultValue={name}
                  onBlur={(event) => void commitRename(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") setRenaming(false);
                  }}
                  maxLength={60}
                  aria-label="Nome do workspace"
                  className="h-6 w-[180px] min-w-0 rounded-md border border-border bg-background px-2 text-sm font-bold text-foreground outline-none focus:border-subtle-foreground"
                />
              ) : (
                <h1
                  onDoubleClick={() => setRenaming(true)}
                  title="Botão direito (ou dois cliques) para renomear"
                  className="min-w-0 truncate text-sm font-bold text-foreground"
                >
                  {name}
                </h1>
              )}
              <span className="shrink-0 text-xs whitespace-nowrap text-subtle-foreground">
                <span className="tabular-nums">{visibleWindows.length}</span>{" "}
                {visibleWindows.length === 1 ? "elemento" : "elementos"}
              </span>
            </div>
          </ContextMenuTrigger>

          <ContextMenuContent>
            <ContextMenuItem onSelect={() => setRenaming(true)}>
              <Pencil className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
              <ContextMenuItemLabel
                label="Renomear o workspace"
                hint="O nome muda em todo lugar: no trilho, nas abas e aqui."
              />
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={fitAll}>
              <Maximize className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
              <ContextMenuItemLabel label="Enquadrar tudo" />
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ToolButton
            label="Nova nota"
            hint="Vira uma nota de verdade: entra na busca e nas tags."
            disabled={atCap || creating}
            onClick={() => spawn({ kind: "note", title: "Nova nota" })}
          >
            <FilePlus2 className="size-4" aria-hidden="true" />
          </ToolButton>

          <ToolButton
            label="Post-it"
            hint="Fica só nesta lousa — a busca não alcança."
            disabled={atCap || creating}
            onClick={() => spawn({ kind: "sticky", tone: "1" })}
          >
            <StickyNote className="size-4" aria-hidden="true" />
          </ToolButton>

          <ToolButton
            label="Caixa de texto"
            hint="Fica só nesta lousa — a busca não alcança."
            disabled={atCap || creating}
            onClick={() => spawn({ kind: "text" })}
          >
            <Type className="size-4" aria-hidden="true" />
          </ToolButton>

          <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />

          {/* As duas ferramentas do ponteiro. Modo, e não clique: ficam
              acesas enquanto estão na mão, e o mesmo botão as guarda. */}
          <ToolButton
            label="Ligar"
            hint={
              tool === "link"
                ? "Clique de novo para guardar."
                : "Toque num elemento e depois no outro."
            }
            disabled={tool !== "link" && windows.length < 2}
            expanded={tool === "link"}
            onClick={() => (tool === "link" ? stopTool() : pickTool("link"))}
          >
            <Spline className="size-4" aria-hidden="true" />
          </ToolButton>

          <ToolButton
            label="Borracha"
            hint={
              tool === "eraser"
                ? "Clique de novo para guardar."
                : "Tira da lousa sem tirar da conta."
            }
            disabled={
              tool !== "eraser" &&
              windows.length === 0 &&
              connections.length === 0
            }
            expanded={tool === "eraser"}
            onClick={() => (tool === "eraser" ? stopTool() : pickTool("eraser"))}
          >
            <Eraser className="size-4" aria-hidden="true" />
          </ToolButton>

          {/* Alterna, não só abre.
              O mesmo botão que abriu é o primeiro lugar em que a pessoa
              clica para fechar — e ele não fazia nada, o que se parece
              exatamente com um painel travado. E ele nunca fica desabilitado
              com o painel aberto: com a lousa no teto de elementos, "trazer"
              está fora de questão, mas "fechar" não. */}
          <ToolButton
            label="Trazer da conta"
            hint={
              pickerOpen
                ? "Clique de novo para fechar."
                : "Abrir aqui algo que você já guardou."
            }
            disabled={!pickerOpen && (atCap || creating)}
            expanded={pickerOpen}
            wide
            onClick={() => setPickerOpen((current) => !current)}
          >
            <FolderInput className="size-4" aria-hidden="true" />
          </ToolButton>
        </div>
      </header>

      {/* `overflow-clip`, e não `overflow-hidden`.

          Os dois recortam igual, mas `hidden` **cria um contêiner rolável** —
          invisível, sem barra, e ainda assim rolável por programa. Com o
          painel "Trazer da conta" fechado, ele fica encostado 384px para
          fora desta moldura: `scrollWidth` passa de 1280 para 1664, e basta
          qualquer coisa pedir uma rolagem para a lousa inteira deslizar.

          E pedir acontece sozinho: focar o campo de busca do painel enquanto
          ele ainda está entrando (a transição leva 300ms) faz o navegador
          rolar o ancestral rolável para trazer o campo à vista. Medido: 147px
          de `scrollLeft` 60ms depois do clique. A partir daí tudo que está
          posicionado aqui dentro aparece deslocado para a esquerda, com uma
          folga do lado direito — e fechar o painel, que o joga 384px para a
          direita, o deixa exatamente em cima da faixa que a rolagem trouxe
          para a tela: ele "não fecha totalmente".

          `clip` não cria contêiner rolável nenhum. Não há o que rolar. */}
      <div ref={frameRef} className="relative min-h-0 flex-1 overflow-clip">
        {/* O fundo. O grid de pontos acompanha pan e zoom, e é ele que dá à
            lousa a sensação de superfície — sem referência visual, arrastar
            no vazio não parece movimento. */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onPointerDown={handleBackgroundPointerDown}
              onPointerMove={handleBackgroundPointerMove}
              onPointerUp={handleBackgroundPointerUp}
              onPointerCancel={handleBackgroundPointerUp}
              onDoubleClick={handleBackgroundDoubleClick}
              onContextMenu={(event) =>
                recordSpawnPoint(event.clientX, event.clientY)
              }
              style={{
                touchAction: "none",
                backgroundImage:
                  "radial-gradient(circle, var(--nx-border) 1px, transparent 1px)",
                backgroundSize: `${DOT_SPACING * viewport.zoom}px ${DOT_SPACING * viewport.zoom}px`,
                backgroundPosition: `${viewport.x}px ${viewport.y}px`,
              }}
              className="absolute inset-0 cursor-grab bg-tertiary active:cursor-grabbing"
            >
              {/* O plano. Uma transformação só carrega todas as janelas — mexer
              em `left`/`top` de cada uma a cada quadro de pan custaria um
              recálculo de layout por janela. */}
              <div
                style={{
                  transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`,
                  transformOrigin: "0 0",
                }}
                className="pointer-events-none absolute inset-0"
              >
                {/* As flechas primeiro: elas passam por baixo das janelas, e
                    quem vem antes no fluxo é pintado embaixo. */}
                <ConnectionLayer
                  connections={visibleConnections}
                  windows={visibleWindows}
                  zoom={viewport.zoom}
                  markedId={underEraserLink}
                  selectedId={selectedConnection?.id ?? null}
                  onSelect={selectConnection}
                  onRemove={removeConnection}
                  onLabel={setLabelingId}
                  inert={usingTool}
                />

                {/* Os rótulos depois do traço e antes das janelas: pintam por
                    cima da flecha e por baixo do conteúdo. */}
                <ConnectionLabels
                  connections={visibleConnections}
                  windows={visibleWindows}
                  zoom={viewport.zoom}
                  editingId={editingLabelId}
                  onEdit={setLabelingId}
                  selectedId={selectedConnection?.id ?? null}
                  onSelect={selectConnection}
                  onCommit={commitConnectionLabel}
                  onRemove={removeConnection}
                  inert={usingTool}
                />

                {linkOrigin && pointerAt && (
                  <PendingConnection
                    from={linkOrigin}
                    to={pointerAt}
                    zoom={viewport.zoom}
                  />
                )}

                {visibleWindows.map((item) => (
                  <div key={item.id} className="pointer-events-auto contents">
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <WindowFrame
                          window={item}
                          zoom={viewport.zoom}
                          title={titleOf(item)}
                          label={labelOf(item)}
                          icon={
                            item.note ? (
                              <NoteTypeIcon
                                type={item.note.type}
                                className="size-3.5 shrink-0 text-subtle-foreground"
                              />
                            ) : item.kind === "attachment" ? (
                              <Paperclip className="size-3.5 shrink-0 text-subtle-foreground" />
                            ) : null
                          }
                          toneClass={surfaceClassOf(item)}
                          focused={focusedId === item.id}
                          onFocus={() => {
                            setFocusedId(item.id);
                            setSelectedLinkId(null);
                            bringToFront(item.id);
                          }}
                          onPreview={(patch) =>
                            updateWindow(item.id, patch, { persist: false })
                          }
                          onCommit={(patch) => updateWindow(item.id, patch)}
                          onClose={() => closeWindow(item.id)}
                        >
                          {item.kind === "attachment" && item.attachment ? (
                            <AttachmentWindowBody
                              attachment={item.attachment}
                              width={item.width}
                            />
                          ) : item.kind === "note" ? (
                            <NoteWindowBody
                              window={item}
                              autoFocus={justCreatedId === item.id}
                              onChange={(patch) =>
                                item.note && updateNote(item.note.id, patch)
                              }
                              onAddTag={(name) =>
                                item.note && addNoteTag(item.note.id, name)
                              }
                              onRemoveTag={(tagId) =>
                                item.note && removeNoteTag(item.note.id, tagId)
                              }
                              onUpdateTag={updateTag}
                            />
                          ) : (
                            <ElementWindowBody
                              window={item}
                              autoFocus={justCreatedId === item.id}
                              onChange={(patch) => updateWindow(item.id, patch)}
                              onCommit={(patch) => updateWindow(item.id, patch)}
                            />
                          )}
                        </WindowFrame>
                      </ContextMenuTrigger>
                      <WindowMenu
                        window={item}
                        onOpenAttachment={
                          item.note?.attachmentId
                            ? () =>
                                spawn({
                                  kind: "attachment",
                                  attachmentId: item.note!.attachmentId!,
                                })
                            : undefined
                        }
                        onOpenEditor={
                          item.note
                            ? () => router.push(`/nota/${item.note!.id}`)
                            : undefined
                        }
                        onLink={() => {
                          pickTool("link");
                          setLinkingFrom(item.id);
                        }}
                        onRaise={() => bringToFront(item.id)}
                        onToggleState={() =>
                          updateWindow(item.id, {
                            state:
                              item.state === "minimized"
                                ? "normal"
                                : "minimized",
                          })
                        }
                        onClose={() => closeWindow(item.id)}
                        onDeleteNote={
                          item.note
                            ? () => deleteNote(item.note!.id)
                            : undefined
                        }
                      />
                    </ContextMenu>
                  </div>
                ))}
              </div>
            </div>
          </ContextMenuTrigger>

          {/* Menu do fundo: cria onde o ponteiro estava. Só abre quando o
            clique não veio de dentro de uma janela — o gatilho da janela já
            marcou o evento como tratado, e o Radix respeita isso. */}
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() =>
                spawn(
                  { kind: "note", title: "Nova nota" },
                  spawnAt.current ?? undefined
                )
              }
            >
              <FilePlus2 className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
              <ContextMenuItemLabel label="Nova nota aqui" />
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                spawn(
                  { kind: "sticky", tone: "1" },
                  spawnAt.current ?? undefined
                )
              }
            >
              <StickyNote className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
              <ContextMenuItemLabel label="Post-it aqui" />
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                spawn({ kind: "text" }, spawnAt.current ?? undefined)
              }
            >
              <Type className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
              <ContextMenuItemLabel label="Caixa de texto aqui" />
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => setPickerOpen(true)}>
              <FolderInput className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
              <ContextMenuItemLabel label="Trazer da conta" />
            </ContextMenuItem>
            <ContextMenuItem onSelect={fitAll}>
              <Maximize className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
              <ContextMenuItemLabel label="Enquadrar tudo" />
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => pickTool("link")}
              disabled={windows.length < 2}
            >
              <Spline className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
              <ContextMenuItemLabel
                label="Ligar elementos"
                hint="Toque num, depois no outro. A flecha aponta para o segundo."
              />
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => pickTool("eraser")}>
              <Eraser className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
              <ContextMenuItemLabel
                label="Borracha"
                hint="Passe por cima para tirar da lousa, um por um."
              />
            </ContextMenuItem>
            <ContextMenuItem
              destructive
              confirmLabel="Apagar tudo mesmo"
              onSelect={clearBoard}
              disabled={windows.length === 0}
            >
              <Trash2 className="mt-0.5 size-4 shrink-0" />
              <ContextMenuItemLabel
                label="Apagar tudo na lousa"
                hint="Notas e arquivos continuam na conta; post-its, não."
              />
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {visibleWindows.length === 0 && (
          <BoardEmptyState
            onCreateNote={() => spawn({ kind: "note", title: "Nova nota" })}
            onOpenPicker={() => setPickerOpen(true)}
          />
        )}

        {/* A camada das ferramentas.

            Existe só enquanto uma delas está na mão, e fica por cima das
            janelas de propósito: o gesto é "passar por cima" ou "tocar",
            não "clicar na janela". Como ela intercepta o ponteiro, quem
            decide o que está embaixo é a conta de `windowAt` e
            `connectionAt` — e não o DOM.

            Vem antes dos controles de zoom no fluxo para eles continuarem
            clicáveis: mesmo nível de empilhamento, e quem vem depois pinta
            por cima. Enquadrar e ampliar seguem funcionando com a
            ferramenta na mão.

            Com a lousa vazia ela não existe: não há o que apagar nem o que
            ligar, e a camada estaria só cobrindo os botões do estado vazio —
            que é justamente o que a pessoa precisa alcançar depois de apagar
            tudo. */}
        {usingTool && visibleWindows.length > 0 && (
          <div
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);

              if (tool === "link") {
                pickForLink(event.clientX, event.clientY);
                return;
              }

              sweeping.current = true;
              sweep(event.clientX, event.clientY);
            }}
            onPointerMove={(event) => {
              if (tool === "link") {
                const hit = windowAt(event.clientX, event.clientY);
                setUnderEraser(hit?.id ?? null);
                // A ponta solta acompanha o ponteiro. Só enquanto existe uma
                // origem: sem ela não há o que desenhar, e guardar a posição
                // à toa seria um render por movimento do mouse.
                if (!linkingFrom) return;
                trackLinkPointer(event.clientX, event.clientY);
                return;
              }

              sweep(event.clientX, event.clientY);
            }}
            onPointerUp={tool === "eraser" ? commitSweep : undefined}
            onPointerCancel={tool === "eraser" ? commitSweep : undefined}
            onPointerLeave={() => {
              setUnderEraser(null);
              setUnderEraserLink(null);
            }}
            style={{ touchAction: "none" }}
            className={cn(
              "absolute inset-0 z-20",
              tool === "link" ? "cursor-cell" : "cursor-crosshair"
            )}
          >
            {/* No primeiro passo, todas as janelas se apresentam como alvos.
                Depois, a origem fica marcada e as demais continuam discretas:
                a pessoa não precisa descobrir onde é possível tocar. */}
            {tool === "link" &&
              visibleWindows.map((item) => {
                const origin = item.id === linkOrigin?.id;
                const hovered = item.id === linkTarget?.id;
                if (origin || hovered) return null;

                return (
                  <div
                    key={item.id}
                    aria-hidden="true"
                    style={frameBox(item, viewport)}
                    className="pointer-events-none absolute rounded-lg border border-dashed border-accent/35 bg-accent/[0.025]"
                  />
                );
              })}

            {/* O alvo, marcado antes de sumir — ou antes de ser ligado. Sem
                isto a ferramenta age sobre o que estiver embaixo sem nunca
                ter dito o que era. */}
            {tool === "eraser" && eraserTarget && (
              <div
                aria-hidden="true"
                style={frameBox(eraserTarget, viewport)}
                className="pointer-events-none absolute rounded-lg border-2 border-error bg-error/10"
              />
            )}

            {/* A origem escolhida continua marcada enquanto o segundo toque
                não vem: sem isso, no meio de uma corrente de ligações, não
                dá para saber de onde a próxima sai. */}
            {linkOrigin && linkOrigin.id !== linkTarget?.id && (
              <div
                aria-hidden="true"
                style={frameBox(linkOrigin, viewport)}
                className="pointer-events-none absolute rounded-lg border-2 border-accent bg-accent/5 shadow-[0_8px_24px_-16px] shadow-accent"
              >
                <span className="absolute -top-3 left-3 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground shadow-sm">
                  Origem
                </span>
              </div>
            )}

            {tool === "link" && linkTarget && (
              <div
                aria-hidden="true"
                style={frameBox(linkTarget, viewport)}
                className={cn(
                  "pointer-events-none absolute rounded-lg border-2 border-accent bg-accent/10 transition-colors duration-150 motion-reduce:transition-none",
                  linkingPending && "animate-pulse motion-reduce:animate-none"
                )}
              >
                <span className="absolute -top-3 left-3 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground shadow-sm">
                  {linkingPending ? "Ligando…" : linkOrigin ? "Destino" : "Começar aqui"}
                </span>
              </div>
            )}
          </div>
        )}

        {/* O aviso da ferramenta. Ele diz as três coisas que a pessoa precisa
            saber para não se assustar: qual ferramenta está na mão, o que ela
            faz com o que encosta, e como sair. */}
        {usingTool && (
          <div className="absolute top-3 left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/95 py-1.5 pr-1.5 pl-3.5 backdrop-blur-sm">
            {tool === "link" ? (
              <Spline
                className="size-4 shrink-0 text-accent"
                aria-hidden="true"
              />
            ) : (
              <Eraser
                className="size-4 shrink-0 text-error"
                aria-hidden="true"
              />
            )}

            <p className="min-w-0 text-xs leading-snug text-muted-foreground">
              <span className="font-semibold text-foreground">
                {tool === "link"
                  ? // `linkOrigin`, não `linkingFrom`: a origem fechada no
                    // meio do gesto deixaria a barra pedindo o destino de uma
                    // janela que já não está na lousa.
                    linkingPending
                    ? "Criando a ligação…"
                    : linkOrigin
                      ? `De “${shortTitle(titleOf(linkOrigin))}” para onde?`
                      : "Escolha de onde a flecha deve sair."
                  : "Passe por cima para tirar da lousa."}
              </span>{" "}
              <span className="hidden sm:inline">
                {tool === "link"
                  ? linkTarget && linkOrigin
                    ? `Destino: “${shortTitle(titleOf(linkTarget))}”.`
                    : "Passe sobre uma nota e toque para confirmar."
                  : "Notas e arquivos continuam na sua conta."}
              </span>
            </p>

            {tool === "eraser" && (
              <button
                type="button"
                onClick={() => (armedClear ? clearBoard() : setArmedClear(true))}
                onBlur={() => setArmedClear(false)}
                disabled={visibleWindows.length === 0}
                className={cn(
                  "flex h-7 shrink-0 items-center rounded-full px-3 text-xs font-semibold whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-9",
                  // Dois passos, como no menu do botão direito: o primeiro
                  // clique arma, o segundo executa. Apagar a lousa inteira é
                  // a ação mais destrutiva daqui.
                  armedClear
                    ? "bg-error text-white"
                    : "text-error hover:bg-error/10"
                )}
              >
                {armedClear ? "Apagar mesmo" : "Apagar tudo"}
              </button>
            )}

            <button
              type="button"
              onClick={stopTool}
              title={
                tool === "link"
                  ? "Guardar a ligação — Esc"
                  : "Guardar a borracha — Esc"
              }
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:size-9"
            >
              <X className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Guardar a ferramenta</span>
            </button>
          </div>
        )}

        {/* Controles de zoom. Existem porque nem todo aparelho tem trackpad
            com pinça, e porque "voltar ao início" precisa ser um clique
            quando a pessoa se perde no plano. */}
        <div className="absolute bottom-4 left-4 z-20 flex items-center gap-0.5 rounded-xl border border-border bg-background/90 p-1 backdrop-blur-sm">
          <ZoomButton
            label="Diminuir zoom"
            hint="Ctrl −"
            disabled={viewport.zoom <= MIN_ZOOM}
            onClick={() => zoomFromCenter((current) => current / ZOOM_STEP)}
          >
            <Minus className="size-4" aria-hidden="true" />
          </ZoomButton>
          <button
            type="button"
            onClick={() => zoomFromCenter(1)}
            title="Voltar a 100% — Ctrl 0"
            className="min-w-[3.25rem] rounded-md py-1 text-center text-xs tabular-nums text-muted-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
          >
            {zoomPercent}%
            <span className="sr-only">Voltar a 100%</span>
          </button>
          <ZoomButton
            label="Aumentar zoom"
            hint="Ctrl +"
            disabled={viewport.zoom >= MAX_ZOOM}
            onClick={() => zoomFromCenter((current) => current * ZOOM_STEP)}
          >
            <Plus className="size-4" aria-hidden="true" />
          </ZoomButton>
          <ZoomButton label="Enquadrar tudo" onClick={fitAll}>
            <Maximize className="size-3.5" aria-hidden="true" />
          </ZoomButton>
        </div>

        {(notice || lastErased || atCap) && (
          <div
            role="status"
            className="absolute bottom-4 left-1/2 z-30 flex max-w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl border border-border bg-background px-4 py-3 shadow-[0_12px_40px_-12px] shadow-black/25"
          >
            <div className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">
              {notice ? (
                <>
                  {notice.message}
                  {notice.upgrade && (
                    <>
                      {" "}
                      <UpgradeLink />
                    </>
                  )}
                  {/* O relato precisa de campo e botões — por isso o
                      contêiner virou `div`: `<div>` dentro de `<p>` faz o
                      navegador fechar o parágrafo sozinho, e o cartão iria
                      junto. */}
                  {notice.code && (
                    <ErrorReport
                      className="mt-2"
                      code={notice.code}
                      route="workspace/[id]"
                      compact
                    />
                  )}
                </>
              ) : lastErased ? (
                eraseSummary(lastErased)
              ) : capIsPlanLimit ? (
                <>
                  Esta lousa chegou aos {windowCap} elementos do plano
                  Gratuito. Feche algo, ou <UpgradeLink label="conheça o Pro" />
                  , onde a lousa não tem esse teto.
                </>
              ) : (
                // Teto absoluto: não é oferta, é proteção — e não há o que
                // vender para quem já está no plano mais alto.
                `Esta lousa chegou ao limite de ${windowCap} elementos. Feche algo para abrir espaço.`
              )}
            </div>

            {/* O desfazer só existe enquanto o cartão está de pé, e é a
                única rede de proteção do post-it: fechar uma nota é
                reversível pela conta, um post-it apagado não existe em
                lugar nenhum. */}
            {!notice && lastErased && (
              <button
                type="button"
                onClick={() => void undoErase()}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-semibold text-accent-foreground transition-colors duration-150 hover:bg-accent/90 pointer-coarse:h-9"
              >
                <Undo2 className="size-3.5" aria-hidden="true" />
                Desfazer
              </button>
            )}

            {(notice || lastErased) && (
              <button
                type="button"
                onClick={() => {
                  dismissError();
                  setRenameError(null);
                  dismissErased();
                }}
                className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">Dispensar aviso</span>
              </button>
            )}
          </div>
        )}

        {selectedTextWindow && (
          <ToolPropertiesPanel
            window={selectedTextWindow}
            onChange={(patch) =>
              updateWindow(selectedTextWindow.id, patch)
            }
            onClose={() => setFocusedId(null)}
          />
        )}

        {selectedConnection && (
          <ConnectionPropertiesPanel
            connection={selectedConnection}
            fromTitle={endpointTitle(selectedConnection.fromWindowId)}
            toTitle={endpointTitle(selectedConnection.toWindowId)}
            onChange={(patch) =>
              void updateConnection(selectedConnection.id, patch)
            }
            onRemove={() => {
              setSelectedLinkId(null);
              removeConnection(selectedConnection.id);
            }}
            onClose={() => setSelectedLinkId(null)}
          />
        )}

        <NotePicker
          workspaceId={workspace.id}
          open={pickerOpen}
          openNoteIds={
            new Set(
              windows
                .map((item) => item.noteId)
                .filter((id): id is string => id !== null)
            )
          }
          onClose={() => setPickerOpen(false)}
          onPick={handlePick}
          onPickAttachment={handlePickAttachment}
        />
      </div>
    </div>
  );

  /** Zoom ancorado no meio do que está sendo visto — o que os botões e os
   *  atalhos usam, já que nenhum dos dois tem um ponteiro para mirar. */
  function zoomFromCenter(next: number | ((current: number) => number)) {
    const box = frameRef.current?.getBoundingClientRect();
    zoomTo(next, (box?.width ?? 800) / 2, (box?.height ?? 600) / 2);
  }
}

/* ---------------------------------------------------------------------- */

/**
 * Menu de uma janela.
 *
 * Fechar e excluir são ações diferentes e dizem isso em voz alta: numa
 * janela de nota, fechar tira da lousa e a nota continua na conta; excluir
 * tira da conta inteira. Num post-it não existe essa distinção — ele só
 * existe aqui —, então só há uma opção, e ela é destrutiva.
 */
function WindowMenu({
  window: item,
  onLink,
  onRaise,
  onToggleState,
  onClose,
  onDeleteNote,
  onOpenAttachment,
  onOpenEditor,
}: {
  window: BoardWindow;
  /** Entra na ferramenta de ligação já com esta janela como origem. */
  onLink: () => void;
  onRaise: () => void;
  onToggleState: () => void;
  onClose: () => void;
  onDeleteNote?: () => void;
  /** Só existe quando a nota desta janela nasceu de um arquivo. */
  onOpenAttachment?: () => void;
  /** Só existe em janela de nota — abre a nota no editor cheio (/nota/[id]). */
  onOpenEditor?: () => void;
}) {
  const minimized = item.state === "minimized";

  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={onRaise}>
        <ArrowUpToLine className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
        <ContextMenuItemLabel label="Trazer para frente" />
      </ContextMenuItem>
      <ContextMenuItem onSelect={onLink}>
        <Spline className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
        <ContextMenuItemLabel
          label="Ligar a partir daqui"
          hint="Depois toque no elemento para onde a flecha aponta."
        />
      </ContextMenuItem>
      <ContextMenuItem onSelect={onToggleState}>
        {minimized ? (
          <Square className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
        ) : (
          <Minus className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
        )}
        <ContextMenuItemLabel label={minimized ? "Expandir" : "Recolher"} />
      </ContextMenuItem>

      {onOpenAttachment && (
        <ContextMenuItem onSelect={onOpenAttachment}>
          <Paperclip className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
          <ContextMenuItemLabel
            label="Abrir o arquivo"
            hint="O documento em si, ao lado do que a Nexo escreveu sobre ele."
          />
        </ContextMenuItem>
      )}

      {onOpenEditor && (
        <ContextMenuItem onSelect={onOpenEditor}>
          <ExternalLink className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
          <ContextMenuItemLabel
            label="Abrir no editor"
            hint="Edição completa: negrito, títulos, listas e exportação em PDF."
          />
        </ContextMenuItem>
      )}

      {item.kind === "attachment" && item.attachment && (
        <ContextMenuItem
          onSelect={() => void downloadAttachment(item.attachment!.id)}
        >
          <Download className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
          <ContextMenuItemLabel label="Baixar o arquivo" />
        </ContextMenuItem>
      )}

      <ContextMenuSeparator />

      {onDeleteNote ? (
        <>
          <ContextMenuItem onSelect={onClose}>
            <X className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
            <ContextMenuItemLabel
              label="Fechar na lousa"
              hint="A nota continua na sua conta, achável pela busca e pelas tags."
            />
          </ContextMenuItem>
          <ContextMenuItem
            destructive
            confirmLabel="Excluir para valer"
            onSelect={onDeleteNote}
          >
            <Trash2 className="mt-0.5 size-4 shrink-0" />
            <ContextMenuItemLabel
              label="Excluir a nota"
              hint="Sai da conta inteira, não só desta lousa."
            />
          </ContextMenuItem>
        </>
      ) : item.kind === "attachment" ? (
        // Fechar um anexo é como fechar uma nota: o arquivo continua na
        // conta. Por isso aqui não é ação destrutiva.
        <ContextMenuItem onSelect={onClose}>
          <X className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
          <ContextMenuItemLabel
            label="Fechar na lousa"
            hint="O arquivo continua guardado na sua conta."
          />
        </ContextMenuItem>
      ) : (
        <ContextMenuItem
          destructive
          confirmLabel="Excluir para valer"
          onSelect={onClose}
        >
          <Trash2 className="mt-0.5 size-4 shrink-0" />
          <ContextMenuItemLabel
            label="Excluir"
            hint="Post-its e caixas de texto vivem só nesta lousa — some de vez."
          />
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );
}

function BoardEmptyState({
  onCreateNote,
  onOpenPicker,
}: {
  onCreateNote: () => void;
  onOpenPicker: () => void;
}) {
  return (
    // `pointer-events-none` no envelope: a lousa continua arrastável por
    // baixo do texto, e só os botões recebem clique.
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h2 className="text-xl font-bold tracking-[-0.01em] text-balance text-foreground">
          Uma superfície vazia, do jeito que você quiser preencher.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-balance text-muted-foreground">
          Escreva direto aqui, cole um lembrete, ou traga para cá algo que você
          já guardou. Dois cliques em qualquer ponto da lousa também criam uma
          nota.
        </p>
        <div className="pointer-events-auto mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onCreateNote}
            className="flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-foreground transition-colors duration-150 hover:bg-accent/90 pointer-coarse:h-11"
          >
            <FilePlus2 className="size-4" aria-hidden="true" />
            Criar uma nota
          </button>
          <button
            type="button"
            onClick={onOpenPicker}
            className="flex h-10 items-center gap-2 rounded-full border border-border bg-background px-5 text-sm font-semibold text-foreground transition-colors duration-150 hover:bg-secondary pointer-coarse:h-11"
          >
            <FolderInput className="size-4" aria-hidden="true" />
            Trazer da conta
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  hint,
  disabled,
  expanded,
  wide,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  disabled?: boolean;
  /** Presente só nos botões que abrem e fecham alguma coisa. */
  expanded?: boolean;
  wide?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        // Devolve o foco ao documento na hora. O `disabled` abaixo já faria
        // isso na maioria dos navegadores, mas depender de efeito colateral
        // de outra propriedade é como esse tipo de bug volta.
        event.currentTarget.blur();
        onClick();
      }}
      disabled={disabled}
      aria-expanded={expanded}
      title={`${label} — ${hint}`}
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm transition-colors duration-150 hover:bg-tertiary hover:text-foreground disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11",
        // Aceso enquanto o que ele abriu está aberto. O rótulo não muda de
        // propósito: "Fechar o painel" tem outra largura, e a barra inteira
        // daria um pulo a cada abertura.
        expanded ? "bg-tertiary text-foreground" : "text-muted-foreground",
        wide && "sm:pr-3"
      )}
    >
      {children}
      <span className={cn(wide ? "hidden sm:inline" : "sr-only")}>{label}</span>
    </button>
  );
}

function ZoomButton({
  label,
  hint,
  disabled,
  onClick,
  children,
}: {
  label: string;
  /** O atalho equivalente, quando existe um. */
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint ? `${label} — ${hint}` : label}
      className="flex size-8 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-10"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

/** Nome real da janela. Vai para o `aria-label`, sempre. */
function titleOf(item: BoardWindow): string {
  if (item.kind === "attachment") return item.attachment?.filename || "Arquivo";
  if (item.kind === "note") return item.note?.title || "Sem título";
  if (item.kind === "sticky") return firstLine(item.content?.text) || "Post-it";
  return firstLine(item.content?.text) || "Texto";
}

function surfaceClassOf(item: BoardWindow): string | undefined {
  if (item.kind === "sticky") {
    return TONE_SURFACE[item.content?.tone ?? "1"];
  }
  if (item.kind !== "text") return undefined;

  const backgroundTone = item.content?.backgroundTone ?? "none";
  if (backgroundTone !== "none") return TONE_SURFACE[backgroundTone];

  // Transparente de verdade não funciona numa lousa: o texto se sobrepõe ao
  // da janela de baixo. A superfície neutra mantém a caixa leve sem fazê-la
  // desaparecer.
  return "border-border/60 bg-background/80 backdrop-blur-sm";
}

/**
 * O que a barra de título mostra.
 *
 * Num post-it ou numa caixa de texto o conteúdo já está logo abaixo, em
 * corpo maior — repeti-lo na barra é a mesma frase duas vezes na mesma
 * janela. Recolhida, porém, o conteúdo some, e aí a primeira linha volta a
 * ser a única forma de saber o que tem ali dentro.
 */
function labelOf(item: BoardWindow): string {
  if (
    item.kind === "note" ||
    item.kind === "attachment" ||
    item.state === "minimized"
  ) {
    return titleOf(item);
  }
  return item.kind === "sticky" ? "Post-it" : "Texto";
}

function firstLine(text: string | undefined): string {
  if (!text) return "";
  const line = text.split("\n")[0]!.trim();
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

/**
 * Baixa o arquivo por uma URL assinada de download.
 *
 * A URL é pedida na hora e vale pouco tempo: nada de link permanente saindo
 * junto com a lista de janelas em toda leitura da lousa.
 */
async function downloadAttachment(attachmentId: string): Promise<void> {
  try {
    const response = await fetch(
      `/api/attachments/${attachmentId}?download=1`,
      { cache: "no-store" }
    );
    if (!response.ok) return;

    const body = await response.json();
    window.open(body.url, "_blank", "noopener,noreferrer");
  } catch {
    // Sem conexão não há o que baixar; a janela continua como está.
  }
}

/**
 * Onde a moldura de destaque de uma janela cai na tela.
 *
 * O realce mora **fora** do plano transformado — ele é da ferramenta, não do
 * arranjo —, então a conversão de coordenadas da lousa para coordenadas do
 * contêiner é feita aqui: multiplica pelo zoom, soma o pan. Dentro do plano
 * ele herdaria a transformação e a espessura da borda cresceria junto,
 * ficando grossa a 200% e sumindo a 40%.
 */
function frameBox(
  item: BoardWindow,
  viewport: { x: number; y: number; zoom: number }
): { left: number; top: number; width: number; height: number } {
  return {
    left: item.x * viewport.zoom + viewport.x,
    top: item.y * viewport.zoom + viewport.y,
    width: frameWidthOf(item) * viewport.zoom,
    height: frameHeightOf(item) * viewport.zoom,
  };
}

/** Mantém os nomes do gesto legíveis sem deixar a barra crescer sem limite. */
function shortTitle(value: string): string {
  return value.length > 28 ? `${value.slice(0, 27).trimEnd()}…` : value;
}

/** O que o cartão de "apagado" diz. */
function eraseSummary(batch: ErasedBatch): string {
  // Só flechas: é a passada que encostou num traço sem encostar em janela
  // nenhuma, e falar de "elementos" ali seria falar de coisa que não saiu.
  if (batch.removed === 0) {
    return batch.connections === 1
      ? "1 ligação removida. Os dois elementos continuam onde estavam."
      : `${batch.connections} ligações removidas. Os elementos continuam onde estavam.`;
  }

  const what =
    batch.removed === 1
      ? "1 elemento saiu"
      : `${batch.removed} elementos saíram`;

  // A distinção que importa: o que continua na conta e o que não continua.
  // Sem ela, "apagado" soa igual nos dois casos — e num deles é definitivo.
  const fate =
    batch.destroyed === 0
      ? "Está tudo na sua conta, achável pela busca e pelas tags."
      : batch.destroyed === batch.removed
        ? "Post-its e caixas de texto vivem só aqui — é agora ou nunca."
        : `Notas e arquivos continuam na sua conta; ${
            batch.destroyed === 1
              ? "1 elemento vivia"
              : `${batch.destroyed} elementos viviam`
          } só nesta lousa.`;

  // As flechas entram no fim, e só quando existem: elas caem por tabela, e
  // quem apagou uma janela não estava pensando nelas.
  const links =
    batch.connections === 0
      ? ""
      : batch.connections === 1
        ? " 1 ligação caiu junto."
        : ` ${batch.connections} ligações caíram junto.`;

  return `${what} da lousa. ${fate}${links}`;
}

function boundsOf(windows: BoardWindow[]) {
  if (windows.length === 0) return null;

  return windows.reduce(
    (box, item) => ({
      minX: Math.min(box.minX, item.x),
      minY: Math.min(box.minY, item.y),
      maxX: Math.max(box.maxX, item.x + item.width),
      maxY: Math.max(box.maxY, item.y + item.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

function snapToGrid(value: number): number {
  return Math.round(value / BOARD_GRID) * BOARD_GRID;
}

/**
 * Quanto a roda pediu, em pixels.
 *
 * `deltaMode` diz em que unidade o navegador está falando: pixels, linhas
 * ou páginas. Ignorá-lo faz o Firefox — que reporta em linhas — deslocar
 * três pixels onde o Chrome desloca cem.
 */
function wheelPixels(event: WheelEvent): { x: number; y: number } {
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
  return { x: event.deltaX * scale, y: event.deltaY * scale };
}

/**
 * O fator de zoom de um giro de roda.
 *
 * Exponencial, e não `1 − delta/100`. Um clique de mouse comum reporta 100
 * pixels, e a conta linear dava fator **zero**: um único giro derrubava a
 * lousa para o zoom mínimo, e o de volta a dobrava. Com a exponencial o
 * mesmo clique tira cerca de 22%, e o arrastar de dois dedos do trackpad,
 * que chega em passos de poucos pixels, continua contínuo. O teto existe
 * para o giro violento de um mouse de roda livre não atravessar a escala
 * inteira num evento só.
 */
function wheelZoomFactor(event: WheelEvent): number {
  const pixels = Math.max(-240, Math.min(240, wheelPixels(event).y));
  return Math.exp(-pixels * 0.0025);
}

function distanceBetween(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
