"use client";

import {
  ArrowLeft,
  ArrowUpToLine,
  BookOpen,
  Circle,
  Diamond,
  Download,
  Eraser,
  ExternalLink,
  FilePlus2,
  Spline,
  FolderInput,
  ImagePlus,
  LoaderCircle,
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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NoteTypeIcon } from "@/components/dashboard/note-type-icon";
import { ErrorReport } from "@/components/errors/error-report";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  BoardMarksLayer,
  type DraftMark,
} from "@/components/workspace/board-marks-layer";
import {
  markContains,
  normalizeStroke,
  simplifyPoints,
  smoothStrokePoints,
} from "@/lib/workspace/board-marks";
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
  type NotePatch,
  type WindowPatch,
} from "@/hooks/use-board-windows";
import {
  boardBackgroundStyle,
  boardSurfaceClass,
  type BoardBackground,
} from "@/lib/workspace/board-background";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  useBoardViewport,
} from "@/hooks/use-board-viewport";
import type {
  BoardConnection,
  BoardMark,
  BoardMarkKind,
  BoardMarkTone,
  BoardWindow,
  BoardWorkspace,
  OpenableAttachment,
  OpenableNote,
} from "@/lib/workspace/queries";
import { cn } from "@/lib/utils";
import { useBoardUploads } from "@/hooks/use-board-uploads";

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

/**
 * Quanto os botões e os atalhos mexem no zoom, por acionamento.
 *
 * Proporcional, e não um número fixo somado: 20 pontos percentuais somados a
 * 160% é um retoque, e os mesmos 20 subtraídos de 40% é quase metade do que
 * se estava vendo. Multiplicar dá o mesmo salto aparente em qualquer altura
 * da escala — 100 → 125 → 156 subindo, 100 → 80 → 64 descendo.
 */
const ZOOM_STEP = 1.25;
/** Janela curta para recuperar uma passada da borracha antes de o aviso sair. */
const ERASE_UNDO_TIMEOUT = 3_000;
/** Conjunto vazio compartilhado. Nunca é mutado — a passada cria um novo. */
const EMPTY_SET: ReadonlySet<string> = new Set();

interface BoardProps {
  workspace: BoardWorkspace;
  initialWindows: BoardWindow[];
  /** As flechas, já lidas junto com as janelas. Ver o comentário da página. */
  initialConnections: BoardConnection[];
  initialMarks: BoardMark[];
  /**
   * Janela em que a lousa deve chegar centralizada.
   *
   * Vem de quem abriu uma nota aqui de fora — do dashboard ou do editor.
   * Sem isso, a janela nova entra abaixo do arranjo e a pessoa chega numa
   * lousa que parece não ter mudado nada.
   */
  focusWindowId: string | null;
  /** Teto de elementos da lousa, só para a mensagem quando ele é atingido. */
  windowCap: number;
}

export function Board({
  workspace,
  initialWindows,
  initialConnections,
  initialMarks,
  focusWindowId,
  windowCap,
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
    marks,
    createMark,
    deleteNote,
  } = useBoardWindows(
    workspace.id,
    initialWindows,
    initialConnections,
    initialMarks
  );

  const router = useRouter();

  // Chegando apontada para uma janela, ela já nasce em destaque — em vez de
  // um efeito mexer nisso depois do primeiro paint.
  const [focusedId, setFocusedId] = useState<string | null>(focusWindowId);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notePendingDelete, setNotePendingDelete] = useState<string | null>(
    null
  );
  const [deleteAttachments, setDeleteAttachments] = useState(false);
  /**
   * Modo de leitura: some com tudo que edita, cria ou apaga, e deixa só o
   * zoom. Não é um `tool` — as ferramentas guardam um gesto em curso e saem
   * sozinhas; o modo de leitura é um estado de tela inteira, que a pessoa
   * escolhe e só ela desfaz.
   */
  const [zenMode, setZenMode] = useState(false);
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
  const [tool, setTool] = useState<
    "none" | "eraser" | "link" | "pen" | "shape"
  >("none");
  const [markTone, setMarkTone] = useState<BoardMarkTone>("default");
  const [markWeight, setMarkWeight] = useState(3);
  const [shapeKind, setShapeKind] =
    useState<Exclude<BoardMarkKind, "pen">>("rectangle");
  const [draftMark, setDraftMark] = useState<DraftMark | null>(null);
  const draftRef = useRef<DraftMark | null>(null);
  const draftFrame = useRef<number | null>(null);
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
  /** Janelas selecionadas no modo ponteiro (V) para mover em bloco. */
  const [selectedWindowIds, setSelectedWindowIds] = useState<ReadonlySet<string>>(
    EMPTY_SET
  );

  /**
   * A "foto" de onde cada janela do grupo estava **no início desta
   * passada** — tirada uma vez só, na primeira chamada de `handleMoveGroup`.
   *
   * Sem ela, cada quadro recalcularia `win.x + dx` sobre o `windows` **já
   * atualizado pelo quadro anterior**: como `dx` é o deslocamento acumulado
   * desde o início do gesto (não incremental — mesma conta de
   * `moveGesture` em `window-frame.tsx`), somar de novo sobre uma base que
   * já inclui o deslocamento de quadros passados dispara uma progressão
   * geométrica. Um arraste de 200 unidades de lousa jogava as outras
   * janelas do grupo a mais de 900 unidades de distância — a lousa parecia
   * explodir. A janela **diretamente arrastada** não sofre disso porque o
   * próprio `WindowFrame` dela já guarda `originX`/`originY` do gesto; é só
   * o resto do grupo, lido daqui, que precisava da mesma garantia.
   */
  const groupMoveOrigin = useRef<Map<string, { x: number; y: number }> | null>(
    null
  );

  /**
   * Move todo o grupo selecionado junto com a janela que a pessoa está
   * arrastando — `dx`/`dy` já vêm em unidades de lousa, acumulados desde o
   * início do gesto.
   *
   * Funções estáveis de propósito: `BoardWindowItem` é memoizado, e uma
   * função nova a cada render desmancharia a memoização de `moveGesture` em
   * `WindowFrame` (mesmo argumento de `focusWindow`/`previewWindow` no resto
   * do arquivo).
   */
  const handleMoveGroup = useCallback(
    (ids: string[], dx: number, dy: number) => {
      if (!groupMoveOrigin.current) {
        const origins = new Map<string, { x: number; y: number }>();
        for (const id of ids) {
          const win = windows.find((item) => item.id === id);
          if (win) origins.set(id, { x: win.x, y: win.y });
        }
        groupMoveOrigin.current = origins;
      }
      for (const windowId of ids) {
        const origin = groupMoveOrigin.current.get(windowId);
        if (origin) {
          updateWindow(windowId, {
            x: snapToGrid(origin.x + dx),
            y: snapToGrid(origin.y + dy),
          });
        }
      }
    },
    [windows, updateWindow]
  );

  const handleMoveGroupEnd = useCallback(() => {
    groupMoveOrigin.current = null;
  }, []);
  /** Marquee de seleção no fundo vazio. */
  const [marquee, setMarquee] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
    active: boolean;
  } | null>(null);
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
  const sweptMarksRef = useRef<ReadonlySet<string>>(EMPTY_SET);
  const [sweptMarks, setSweptMarks] = useState<ReadonlySet<string>>(EMPTY_SET);
  const sweeping = useRef(false);
  /** Espelho da `marquee` para leitura nos handlers sem quebrar `useCallback`. */
  const marqueeRef = useRef<typeof marquee>(null);
  /** Espelho de `visibleWindows` para leitura no handler de up. */
  const visibleWindowsRef = useRef<typeof visibleWindows>([]);
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
  /** Uma falha ao gravar algo do workspace: o nome ou o fundo. */
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  /**
   * O fundo da lousa.
   *
   * Otimista como o nome, e pelo mesmo motivo: quem clica numa amostra está
   * olhando para a lousa, e esperar a ida ao servidor para a cor mudar faria
   * o clique parecer perdido. Recusado, o fundo volta ao que era.
   *
   * O espelho em `ref` existe para `changeBackground` não depender do estado
   * — é o que mantém a identidade dela estável e, com ela, o `memo` de cada
   * janela valendo alguma coisa durante um arraste.
   */
  const [background, setBackground] = useState<BoardBackground>(
    workspace.background
  );
  const backgroundRef = useRef(background);

  const changeBackground = useCallback(
    async (patch: Partial<BoardBackground>) => {
      const previous = backgroundRef.current;
      const next = { ...previous, ...patch };
      backgroundRef.current = next;
      setBackground(next);
      setWorkspaceError(null);

      function rollback(message: string) {
        backgroundRef.current = previous;
        setBackground(previous);
        setWorkspaceError(message);
      }

      try {
        const response = await fetch(`/api/workspaces/${workspace.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            boardPattern: next.pattern,
            boardTone: next.tone,
          }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          rollback(body?.error ?? "Não foi possível mudar o fundo.");
        }
      } catch {
        rollback("Sem conexão. O fundo não mudou.");
      }
    },
    [workspace.id]
  );

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
      setWorkspaceError(null);

      try {
        const response = await fetch(`/api/workspaces/${workspace.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: next }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setName(previous);
          setWorkspaceError(body?.error ?? "Não foi possível renomear.");
        }
      } catch {
        setName(previous);
        setWorkspaceError("Sem conexão. O nome não mudou.");
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
      if (
        event.key === "+" ||
        event.key === "=" ||
        event.code === "NumpadAdd"
      ) {
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

  const boardPointFromEvent = useCallback(
    (event: React.PointerEvent) => {
      const point = toContainer(event.clientX, event.clientY);
      return toBoard(point.x, point.y);
    },
    [toBoard, toContainer]
  );

  const handleBackgroundPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Só o fundo arrasta a lousa. Um `pointerdown` que veio de dentro de
      // uma janela já foi tratado lá e não pode virar pan.
      if (event.target !== event.currentTarget) return;

      // Marquee: só no modo ponteiro (tool === "none") e clique esquerdo.
      // O handler já roda só no fundo vazio (event.target === currentTarget),
      // então windowAt() == null aqui significa clique no vazio.
      if (tool === "none" && event.button === 0) {
        const hit = windowAt(event.clientX, event.clientY);
        if (!hit) {
          event.currentTarget.setPointerCapture(event.pointerId);
          // `handleBackgroundPointerMove` começa recusando qualquer ponteiro
          // que não esteja aqui — sem esta linha o marquee nasce e trava no
          // tamanho zero, porque o primeiro `pointermove` sai fora antes de
          // olhar para `marqueeRef`.
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          const point = boardPointFromEvent(event);
          const nextMarquee = {
            start: { x: point.x, y: point.y },
            current: { x: point.x, y: point.y },
            active: true,
          };
          marqueeRef.current = nextMarquee;
          setMarquee(nextMarquee);
          return; // Não inicia pan nem limpa seleção enquanto marquee ativo
        }
      }

      setFocusedId(null);
      setSelectedLinkId(null);
      setSelectedWindowIds(EMPTY_SET);
      marqueeRef.current = null;
      setMarquee(null);
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
    [tool, viewport.zoom, recordSpawnPoint, windowAt, boardPointFromEvent]
  );

  const handleBackgroundPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const previous = pointers.current.get(event.pointerId);
      if (!previous) return;

      const next = { x: event.clientX, y: event.clientY };
      pointers.current.set(event.pointerId, next);

      // Marquee ativo: atualiza retângulo e não faz pan
      if (marqueeRef.current?.active) {
        const point = boardPointFromEvent(event);
        const nextMarquee = {
          ...marqueeRef.current,
          current: { x: point.x, y: point.y },
        };
        marqueeRef.current = nextMarquee;
        setMarquee(nextMarquee);
        return;
      }

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
    [panBy, zoomTo, toContainer, boardPointFromEvent]
  );

  const handleBackgroundPointerUp = useCallback((event: React.PointerEvent) => {
    // Marquee ativo: finaliza seleção
    if (marqueeRef.current?.active) {
      const m = marqueeRef.current;
      const minX = Math.min(m.start.x, m.current.x);
      const maxX = Math.max(m.start.x, m.current.x);
      const minY = Math.min(m.start.y, m.current.y);
      const maxY = Math.max(m.start.y, m.current.y);

      const selected = new Set<string>();
      for (const item of visibleWindowsRef.current) {
        const itemMinX = item.x;
        const itemMaxX = item.x + frameWidthOf(item);
        const itemMinY = item.y;
        const itemMaxY = item.y + frameHeightOf(item);
        if (
          itemMaxX >= minX &&
          itemMinX <= maxX &&
          itemMaxY >= minY &&
          itemMinY <= maxY
        ) {
          selected.add(item.id);
        }
      }
      setSelectedWindowIds(selected);
      marqueeRef.current = null;
      setMarquee(null);
      pointers.current.delete(event.pointerId);
      return;
    }

    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }, []);

  /* ---------------------------------------------------------------- */
  /* Borracha e ligação — as duas ferramentas do ponteiro              */
  /* ---------------------------------------------------------------- */

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
      let mark: BoardMark | null = null;
      if (!hit && !link) {
        for (let index = marks.length - 1; index >= 0; index -= 1) {
          const candidate = marks[index];
          if (
            !sweptMarksRef.current.has(candidate.id) &&
            markContains(candidate, at, 8 / viewport.zoom)
          ) {
            mark = candidate;
            break;
          }
        }
      }

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
        return;
      }

      if (mark && !sweptMarksRef.current.has(mark.id)) {
        const next = new Set(sweptMarksRef.current).add(mark.id);
        sweptMarksRef.current = next;
        setSweptMarks(next);
      }
    },
    [windowAt, toContainer, toBoard, connections, windows, marks, viewport.zoom]
  );

  const commitSweep = useCallback(() => {
    sweeping.current = false;

    const windowIds = [...sweptRef.current];
    const linkIds = [...sweptLinksRef.current];
    const markIds = [...sweptMarksRef.current];
    sweptRef.current = EMPTY_SET;
    sweptLinksRef.current = EMPTY_SET;
    sweptMarksRef.current = EMPTY_SET;
    setSwept(EMPTY_SET);
    setSweptLinks(EMPTY_SET);
    setSweptMarks(EMPTY_SET);

    if (windowIds.length > 0 || linkIds.length > 0 || markIds.length > 0) {
      void erase({ windows: windowIds, connections: linkIds, marks: markIds });
    }
  }, [erase]);

  /**
   * Guarda a ferramenta.
   *
   * Fechar a borracha também encerra a passada atual. O botão fica acima da
   * camada de gesto e pode receber o clique antes de o pointerup dela; limpar
   * os conjuntos aqui sem commit fazia o desenho apenas escondido reaparecer.
   */
  const stopTool = useCallback(() => {
    if (
      tool === "eraser" &&
      (sweptRef.current.size > 0 ||
        sweptLinksRef.current.size > 0 ||
        sweptMarksRef.current.size > 0)
    ) {
      commitSweep();
    }

    linkSession.current += 1;
    sweeping.current = false;
    sweptRef.current = EMPTY_SET;
    sweptLinksRef.current = EMPTY_SET;
    sweptMarksRef.current = EMPTY_SET;
    setSwept(EMPTY_SET);
    setSweptLinks(EMPTY_SET);
    setSweptMarks(EMPTY_SET);
    draftRef.current = null;
    setDraftMark(null);
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
    if (draftFrame.current !== null) {
      cancelAnimationFrame(draftFrame.current);
      draftFrame.current = null;
    }
    setTool("none");
  }, [commitSweep, tool]);

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
  const pickTool = useCallback(
    (next: "eraser" | "link" | "pen" | "shape") => {
      if (zenMode) return;
      linkSession.current += 1;
      setLabelingId(null);
      setTool(next);
    },
    [zenMode]
  );

  /** A mesma conversão, para quem só tem `clientX`/`clientY` na mão — a
   * alça da curva, dentro do SVG das ligações, que não recebe o evento do
   * React na forma de `PointerEvent` da lousa. */
  const toBoardPoint = useCallback(
    (clientX: number, clientY: number) => {
      const point = toContainer(clientX, clientY);
      return toBoard(point.x, point.y);
    },
    [toBoard, toContainer]
  );

  /** A alça da curva grava sempre os dois campos juntos — nunca um sozinho,
   * senão o CHECK do banco (`(bend_t IS NULL) = (bend_offset IS NULL)`)
   * derruba o PATCH. */
  const handleBendChange = useCallback(
    (id: string, bendT: number, bendOffset: number) => {
      void updateConnection(id, { bendT, bendOffset });
    },
    [updateConnection]
  );

  const paintDraft = useCallback(() => {
    if (draftFrame.current !== null) return;
    draftFrame.current = requestAnimationFrame(() => {
      draftFrame.current = null;
      setDraftMark(
        draftRef.current
          ? { ...draftRef.current, points: [...draftRef.current.points] }
          : null
      );
    });
  }, []);

  const startDrawing = useCallback(
    (event: React.PointerEvent) => {
      if (tool !== "pen" && tool !== "shape") return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = boardPointFromEvent(event);
      draftRef.current = {
        kind: tool === "pen" ? "pen" : shapeKind,
        points: tool === "pen" ? [point] : [],
        start: point,
        end: point,
        tone: markTone,
        weight: markWeight,
      };
      setDraftMark(draftRef.current);
    },
    [boardPointFromEvent, markTone, markWeight, shapeKind, tool]
  );

  const moveDrawing = useCallback(
    (event: React.PointerEvent) => {
      const draft = draftRef.current;
      if (!draft) return;
      const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [
        event.nativeEvent,
      ];
      if (draft.kind === "pen") {
        for (const pointer of coalesced) {
          const container = toContainer(pointer.clientX, pointer.clientY);
          draft.points.push(toBoard(container.x, container.y));
        }
      } else {
        draft.end = boardPointFromEvent(event);
      }
      paintDraft();
    },
    [boardPointFromEvent, paintDraft, toBoard, toContainer]
  );

  const finishDrawing = useCallback(
    (event: React.PointerEvent) => {
      const draft = draftRef.current;
      draftRef.current = null;
      setDraftMark(null);
      if (!draft) return;
      if (draft.kind === "pen") {
        // O pointerup pode chegar depois do último pointermove. Guardar a
        // posição final evita a pequena ponta reta/curta que isso produzia.
        draft.points.push(boardPointFromEvent(event));
        const points = simplifyPoints(
          smoothStrokePoints(draft.points),
          Math.max(0.8, 1.5 / viewport.zoom)
        );
        if (points.length < 2) return;
        const normalized = normalizeStroke(points);
        void createMark({
          kind: "pen",
          ...normalized,
          tone: draft.tone,
          weight: draft.weight,
        });
        return;
      }
      draft.end = boardPointFromEvent(event);
      const width = Math.round(Math.abs(draft.end.x - draft.start.x));
      const height = Math.round(Math.abs(draft.end.y - draft.start.y));
      if (width < 4 || height < 4) return;
      void createMark({
        kind: draft.kind,
        points: [],
        x: Math.round(Math.min(draft.start.x, draft.end.x)),
        y: Math.round(Math.min(draft.start.y, draft.end.y)),
        width,
        height,
        tone: draft.tone,
        weight: draft.weight,
      });
    },
    [boardPointFromEvent, createMark, viewport.zoom]
  );

  const cancelDrawing = useCallback(() => {
    draftRef.current = null;
    setDraftMark(null);
  }, []);

  /**
   * Liga ou desliga o modo de leitura.
   *
   * Entrar guarda a ferramenta na mão, fecha "Trazer da conta" e cancela um
   * renomeio em curso — as três coisas que o resto do modo passa a impedir
   * de começar, mas que já podiam estar abertas de antes do clique.
   */
  const toggleZenMode = useCallback(() => {
    setZenMode((current) => {
      const next = !current;
      if (next) {
        stopTool();
        setPickerOpen(false);
        setRenaming(false);
      }
      return next;
    });
  }, [stopTool]);

  const clearBoard = useCallback(() => {
    setArmedClear(false);
    // Só as janelas: as flechas caem junto por cascade, no banco.
    void erase({ windows: "all", marks: "all" });
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
    swept.size === 0 ? windows : windows.filter((item) => !swept.has(item.id));

  // Espelha visibleWindows no ref para o handler de up ler sem dependência
  useEffect(() => {
    visibleWindowsRef.current = visibleWindows;
  }, [visibleWindows]);

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
  const visibleMarks =
    sweptMarks.size === 0
      ? marks
      : marks.filter((mark) => !sweptMarks.has(mark.id));

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
  /**
   * O elemento aberto no inspetor.
   *
   * **Qualquer tipo**, e não só a caixa de texto como antes. O fundo da lousa
   * mora neste painel, e ele precisa ser alcançável a partir de qualquer
   * coisa que a pessoa tenha na tela — exigir uma caixa de texto para poder
   * trocar o fundo seria pedir que ela criasse um elemento para mexer noutro.
   */
  const selectedWindow =
    !usingTool && !pickerOpen && !zenMode
      ? (visibleWindows.find((item) => item.id === focusedId) ?? null)
      : null;

  useEffect(() => {
    if (!selectedWindow) return;

    function closeProperties(event: KeyboardEvent) {
      if (event.key === "Escape") setFocusedId(null);
    }

    window.addEventListener("keydown", closeProperties);
    return () => window.removeEventListener("keydown", closeProperties);
  }, [selectedWindow]);

  /**
   * A flecha do inspetor, **se ela ainda existir** — mesma conta do
   * `editingLabelId` abaixo: apagada noutro dispositivo, o inspetor some em
   * vez de editar uma linha que não está mais lá.
   */
  const selectedConnection =
    !usingTool && !pickerOpen && !selectedWindow && !zenMode && selectedLinkId
      ? (visibleConnections.find((item) => item.id === selectedLinkId) ?? null)
      : null;

  function endpointTitle(windowId: string): string {
    const item = windows.find((candidate) => candidate.id === windowId);
    return item ? titleOf(item) : "Elemento";
  }

  const selectConnection = useCallback(
    (id: string) => {
      if (zenMode) return;
      setFocusedId(null);
      setSelectedLinkId(id);
    },
    [zenMode]
  );

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

  /** Retângulo que contém janelas e desenhos. */
  const bounds = boundsOfBoard(visibleWindows, visibleMarks);

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
    if (framed.current || (windows.length === 0 && marks.length === 0)) return;

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
    fitTo(boundsOfBoard(windows, marks), box.width, box.height);
  }, [focusWindowId, restored, windows, marks, fitTo]);

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
  const spawnPoint = useCallback(
    (kind: BoardWindow["kind"]) => {
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
    },
    [toBoard]
  );

  const spawn = useCallback(
    async (
      input: Omit<CreateWindowInput, "x" | "y">,
      at?: { x: number; y: number }
    ) => {
      // Cinturão e suspensório: a barra some e o menu de contexto fica
      // desligado no modo de leitura, mas um gesto só chega até aqui de
      // verdade se ninguém conseguir mais acioná-lo.
      if (zenMode) return;
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
    [createWindow, spawnPoint, zenMode]
  );

  /**
   * Atalhos de uma tecla, como nas ferramentas de desenho conhecidas.
   * Campos de texto, menus e diálogos mantêm as teclas para si; na lousa,
   * repetir a tecla da ferramenta guarda-a e V volta ao ponteiro.
   *
   * **`button` entra na lista por causa de um Tab perdido.** Da caixa de
   * título de uma nota, Tab não pousa no corpo — pousa no "+ tag" (é o
   * próximo elemento focável na ordem do DOM). Um `<button>` não consome
   * letras para si, então elas seguiam batendo aqui: a primeira tecla que
   * batesse com um atalho trocava de ferramenta no meio da digitação, sem
   * a pessoa ter pedido. `role='menuitem'` entra pelo mesmo motivo, para
   * um item de menu focado por teclado.
   */
  useEffect(() => {
    function handleToolShortcut(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        zenMode ||
        pickerOpen
      ) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, button, [contenteditable='true'], [role='dialog'], [role='menu'], [role='menuitem']"
        )
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const shortcutTool = {
        p: "pen",
        f: "shape",
        l: "link",
        b: "eraser",
      }[key] as "pen" | "shape" | "link" | "eraser" | undefined;

      if (key === "v") {
        if (tool !== "none") {
          event.preventDefault();
          stopTool();
        }
        return;
      }
      if (!shortcutTool) return;
      if (shortcutTool === "link" && tool !== "link" && windows.length < 2)
        return;
      if (
        shortcutTool === "eraser" &&
        tool !== "eraser" &&
        windows.length === 0 &&
        connections.length === 0 &&
        marks.length === 0
      ) {
        return;
      }

      event.preventDefault();
      if (tool === shortcutTool) stopTool();
      else pickTool(shortcutTool);
    }

    window.addEventListener("keydown", handleToolShortcut);
    return () => window.removeEventListener("keydown", handleToolShortcut);
  }, [
    connections.length,
    marks.length,
    pickerOpen,
    pickTool,
    stopTool,
    tool,
    windows.length,
    zenMode,
  ]);

  const handleBackgroundDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (zenMode || event.target !== event.currentTarget) return;

      const point = toContainer(event.clientX, event.clientY);
      const board = toBoard(point.x, point.y);
      spawn(
        { kind: "note", title: "Nova nota" },
        { x: snapToGrid(board.x), y: snapToGrid(board.y) }
      );
    },
    [toContainer, toBoard, spawn, zenMode]
  );

  /* ---------------------------------------------------------------- */
  /* Os repasses de cada janela                                        */
  /*                                                                   */
  /* Identidade estável, e é o que faz o `memo` do `BoardWindowItem`    */
  /* valer: durante um arraste só a janela arrastada muda de objeto, e  */
  /* com estes retornos fixos as outras vinte não re-renderizam sessenta */
  /* vezes por segundo. Uma função anônima criada no `map` desmancharia */
  /* a memoização inteira — cada quadro traria props novas para todas.  */
  /* ---------------------------------------------------------------- */

  const focusWindow = useCallback(
    (id: string) => {
      setFocusedId(id);
      setSelectedLinkId(null);
      bringToFront(id);
    },
    [bringToFront]
  );

  const previewWindow = useCallback(
    (id: string, patch: WindowPatch) =>
      updateWindow(id, patch, { persist: false }),
    [updateWindow]
  );

  const commitWindow = useCallback(
    (id: string, patch: WindowPatch) => updateWindow(id, patch),
    [updateWindow]
  );

  const startLinkFrom = useCallback(
    (id: string) => {
      pickTool("link");
      setLinkingFrom(id);
    },
    [pickTool]
  );

  const openNoteEditor = useCallback(
    (noteId: string) => router.push(`/nota/${noteId}`),
    [router]
  );

  const openAttachmentWindow = useCallback(
    (attachmentId: string) => void spawn({ kind: "attachment", attachmentId }),
    [spawn]
  );

  /**
   * As notas já abertas, para o painel não oferecer o que já está na lousa.
   *
   * A chave é a lista de ids em texto, e não o array de janelas: arrastar uma
   * janela troca o array a cada quadro sem mexer em id nenhum, e um conjunto
   * novo por quadro faria o `memo` do painel não valer nada justamente
   * durante o gesto em que ele mais atrapalha.
   */
  const openNoteKey = windows.map((item) => item.noteId ?? "").join(",");
  const openNoteIds = useMemo(
    () =>
      new Set(openNoteKey.split(",").filter((id): id is string => id !== "")),
    [openNoteKey]
  );

  const closePicker = useCallback(() => setPickerOpen(false), []);

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

  /* --- Arquivo do computador direto na lousa ------------------------ */

  const boardPointAt = useCallback(
    (clientX: number, clientY: number) => {
      const point = toContainer(clientX, clientY);
      return toBoard(point.x, point.y);
    },
    [toContainer, toBoard]
  );

  const viewCenter = useCallback(() => {
    const box = frameRef.current?.getBoundingClientRect();
    return toBoard((box?.width ?? 800) / 2, (box?.height ?? 600) / 2);
  }, [toBoard]);

  const placeUploaded = useCallback(
    async (
      attachmentId: string,
      at: { x: number; y: number },
      size: { width: number; height: number } | null
    ) => {
      await spawn(
        { kind: "attachment", attachmentId, ...(size ?? {}) },
        { x: snapToGrid(at.x), y: snapToGrid(at.y) }
      );
    },
    [spawn]
  );

  const uploads = useBoardUploads({
    enabled: !zenMode && windows.length < windowCap,
    toBoardPoint: boardPointAt,
    viewCenter,
    place: placeUploaded,
    onError: setWorkspaceError,
  });

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
    error ?? (workspaceError ? { message: workspaceError, code: null } : null);

  /**
   * A recuperação é deliberadamente curta: o cartão não vira uma peça fixa
   * da lousa, mas ainda deixa claro por quanto tempo o Desfazer está vivo.
   * O cleanup também impede que o timer de uma passada anterior dispense o
   * cartão mais novo.
   */
  //
  // O relógio para enquanto o ponteiro ou o foco estão no cartão: três
  // segundos não bastam para ler, decidir e alcançar o botão, e sumir com o
  // Desfazer debaixo do cursor seria o cartão vencendo a pessoa (WCAG 2.2.1).
  // A pausa é guardada junto com a passada que ela segura, para um cartão
  // que sumiu com o ponteiro em cima não deixar o próximo pausado para sempre.
  const [heldErase, setHeldErase] = useState<typeof lastErased>(null);
  const undoHeld = lastErased !== null && heldErase === lastErased;
  const undoClock = useRef<{ erase: typeof lastErased; remaining: number }>({
    erase: null,
    remaining: ERASE_UNDO_TIMEOUT,
  });

  useEffect(() => {
    if (!lastErased) return;
    if (undoClock.current.erase !== lastErased) {
      undoClock.current = { erase: lastErased, remaining: ERASE_UNDO_TIMEOUT };
    }
    if (undoHeld) return;

    const startedAt = performance.now();
    const timeout = window.setTimeout(
      dismissErased,
      undoClock.current.remaining
    );
    return () => {
      window.clearTimeout(timeout);
      undoClock.current.remaining = Math.max(
        0,
        undoClock.current.remaining - (performance.now() - startedAt)
      );
    };
  }, [lastErased, undoHeld, dismissErased]);

  return (
    <div
      data-app-viewport=""
      className="flex h-[100dvh] flex-col overflow-clip overscroll-contain bg-background"
    >
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
          <ContextMenuTrigger asChild disabled={zenMode}>
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
                  onDoubleClick={() => !zenMode && setRenaming(true)}
                  title={
                    zenMode
                      ? name
                      : "Botão direito (ou dois cliques) para renomear"
                  }
                  className="min-w-0 truncate text-sm font-bold text-foreground"
                >
                  {name}
                </h1>
              )}
              <span className="shrink-0 text-xs whitespace-nowrap text-subtle-foreground">
                <span className="tabular-nums">
                  {visibleWindows.length + visibleMarks.length}
                </span>{" "}
                {visibleWindows.length + visibleMarks.length === 1
                  ? "elemento"
                  : "elementos"}
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

        {zenMode && (
          <p className="ml-auto flex h-9 shrink-0 items-center text-xs text-subtle-foreground">
            Modo de leitura — só o zoom mexe.
          </p>
        )}

        {!zenMode && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ToolButton
              label="Nova nota"
              hint="Vira nota de verdade — ou 2 cliques na lousa"
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

            <ToolButton
              label="Caneta"
              hint={
                tool === "pen"
                  ? "Clique de novo para guardar."
                  : "Desenhe livremente na lousa."
              }
              shortcut="P"
              expanded={tool === "pen"}
              onClick={() => (tool === "pen" ? stopTool() : pickTool("pen"))}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </ToolButton>

            <ToolButton
              label="Formas"
              hint={
                tool === "shape"
                  ? "Clique de novo para guardar."
                  : "Retângulo, elipse ou losango."
              }
              shortcut="F"
              expanded={tool === "shape"}
              onClick={() =>
                tool === "shape" ? stopTool() : pickTool("shape")
              }
            >
              <Square className="size-4" aria-hidden="true" />
            </ToolButton>

            {/* As ferramentas do ponteiro. Modo, e não clique: ficam
                acesas enquanto estão na mão, e o mesmo botão as guarda. */}
            <ToolButton
              label="Ligar"
              hint={
                tool === "link"
                  ? "Clique de novo para guardar."
                  : "Toque num elemento e depois no outro."
              }
              shortcut="L"
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
              shortcut="B"
              disabled={
                tool !== "eraser" &&
                windows.length === 0 &&
                connections.length === 0 &&
                marks.length === 0
              }
              expanded={tool === "eraser"}
              onClick={() =>
                tool === "eraser" ? stopTool() : pickTool("eraser")
              }
            >
              <Eraser className="size-4" aria-hidden="true" />
            </ToolButton>

            {/* Alterna, não só abre.
                O mesmo botão que abriu é o primeiro lugar em que a pessoa
                clica para fechar — e ele não fazia nada, o que se parece
                exatamente com um painel travado. E ele nunca fica
                desabilitado com o painel aberto: com a lousa no teto de
                elementos, "trazer" está fora de questão, mas "fechar" não. */}
            <input {...uploads.inputProps} />
            <ToolButton
              label="Enviar arquivo"
              hint={
                uploads.sending
                  ? `Enviando ${uploads.sending}…`
                  : "Imagem, PDF, texto ou áudio — também dá para arrastar ou colar aqui."
              }
              disabled={atCap || uploads.sending !== null}
              onClick={uploads.pickFiles}
            >
              {uploads.sending ? (
                <LoaderCircle
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <ImagePlus className="size-4" aria-hidden="true" />
              )}
            </ToolButton>

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
        )}
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
      <div
        ref={frameRef}
        className="relative min-h-0 flex-1 overflow-clip"
        {...uploads.dropHandlers}
      >
        {uploads.dropping && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-background/80 backdrop-blur-[2px]"
          >
            <span className="rounded-full bg-background px-4 py-2 text-sm font-medium text-foreground shadow-[0_8px_24px_-12px] shadow-black/30">
              Solte para pôr na lousa
            </span>
          </div>
        )}
        {uploads.sending && (
          <p
            role="status"
            className="absolute top-3 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-background px-3.5 py-1.5 text-xs text-muted-foreground shadow-[0_8px_24px_-12px] shadow-black/30 ring-1 ring-border"
          >
            <LoaderCircle
              className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span className="truncate">Enviando {uploads.sending}…</span>
          </p>
        )}
        {/* O fundo. A trama acompanha pan e zoom, e é ela que dá à lousa a
            sensação de superfície — sem referência visual, arrastar no vazio
            não parece movimento. Qual trama e qual cor é escolha da pessoa,
            guardada no workspace: ver `lib/workspace/board-background.ts`. */}
        <ContextMenu>
          <ContextMenuTrigger asChild disabled={zenMode}>
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
                ...boardBackgroundStyle(background, viewport),
              }}
              className={cn(
                "absolute inset-0 cursor-grab active:cursor-grabbing",
                boardSurfaceClass(background.tone)
              )}
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
                <BoardMarksLayer marks={visibleMarks} draft={draftMark} />

                {/* O retângulo do marquee. Coordenadas de lousa cruas — este
                    `<div>` já está dentro da camada transformada (pan e
                    zoom), então `left`/`top`/`width`/`height` em unidades de
                    lousa bastam, sem conta extra de viewport. Sem isto a
                    pessoa arrastava às cegas: a seleção acontecia (o
                    `pointerup` já calculava certo), mas nada na tela mostrava
                    o retângulo enquanto o gesto estava em curso. */}
                {marquee?.active && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute rounded-md border-2 border-dashed border-accent bg-accent/10"
                    style={{
                      left: Math.min(marquee.start.x, marquee.current.x),
                      top: Math.min(marquee.start.y, marquee.current.y),
                      width: Math.abs(marquee.current.x - marquee.start.x),
                      height: Math.abs(marquee.current.y - marquee.start.y),
                    }}
                  />
                )}

                <ConnectionLayer
                  connections={visibleConnections}
                  windows={visibleWindows}
                  zoom={viewport.zoom}
                  markedId={underEraserLink}
                  selectedId={selectedConnection?.id ?? null}
                  onSelect={selectConnection}
                  onRemove={removeConnection}
                  onLabel={setLabelingId}
                  onBendChange={handleBendChange}
                  toBoardPoint={toBoardPoint}
                  inert={usingTool || zenMode}
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
                  inert={usingTool || zenMode}
                />

                {linkOrigin && pointerAt && (
                  <PendingConnection
                    from={linkOrigin}
                    to={pointerAt}
                    zoom={viewport.zoom}
                  />
                )}

                {visibleWindows.map((item) => (
                  <BoardWindowItem
                    key={item.id}
                    item={item}
                    zoom={viewport.zoom}
                    focused={focusedId === item.id}
                    autoFocus={justCreatedId === item.id}
                    readOnly={zenMode}
                    onFocus={focusWindow}
                    onPreview={previewWindow}
                    onCommit={commitWindow}
                    onClose={closeWindow}
                    onNoteChange={updateNote}
                    onAddTag={addNoteTag}
                    onRemoveTag={removeNoteTag}
                    onUpdateTag={updateTag}
                    onLinkFrom={startLinkFrom}
                    onRaise={bringToFront}
                    onOpenAttachment={openAttachmentWindow}
                    onOpenEditor={openNoteEditor}
                    onDeleteNote={(noteId) => {
                      setDeleteAttachments(false);
                      setNotePendingDelete(noteId);
                    }}
                    selectedWindowIds={selectedWindowIds}
                    onMoveGroup={handleMoveGroup}
                    onMoveGroupEnd={handleMoveGroupEnd}
                  />
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
              disabled={windows.length === 0 && marks.length === 0}
            >
              <Trash2 className="mt-0.5 size-4 shrink-0" />
              <ContextMenuItemLabel
                label="Apagar tudo na lousa"
                hint="Notas e arquivos continuam na conta; post-its, não."
              />
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {visibleWindows.length === 0 && visibleMarks.length === 0 && (
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
        {usingTool &&
          (tool === "pen" ||
            tool === "shape" ||
            visibleWindows.length > 0 ||
            visibleMarks.length > 0) && (
            <div
              onPointerDown={(event) => {
                if (event.button !== 0) return;

                if (tool === "pen" || tool === "shape") {
                  startDrawing(event);
                  return;
                }

                event.currentTarget.setPointerCapture(event.pointerId);

                if (tool === "link") {
                  pickForLink(event.clientX, event.clientY);
                  return;
                }

                sweeping.current = true;
                sweep(event.clientX, event.clientY);
              }}
              onPointerMove={(event) => {
                if (tool === "pen" || tool === "shape") {
                  moveDrawing(event);
                  return;
                }
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
              onPointerUp={
                tool === "eraser"
                  ? commitSweep
                  : tool === "pen" || tool === "shape"
                    ? finishDrawing
                    : undefined
              }
              onPointerCancel={
                tool === "eraser"
                  ? commitSweep
                  : tool === "pen" || tool === "shape"
                    ? cancelDrawing
                    : undefined
              }
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
                    {linkingPending
                      ? "Ligando…"
                      : linkOrigin
                        ? "Destino"
                        : "Começar aqui"}
                  </span>
                </div>
              )}
            </div>
          )}

        {/* O aviso da ferramenta. Ele diz as três coisas que a pessoa precisa
            saber para não se assustar: qual ferramenta está na mão, o que ela
            faz com o que encosta, e como sair. */}
        {usingTool && (
          <div className="absolute top-3 left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-background/95 py-1.5 pr-1.5 pl-3.5 backdrop-blur-sm sm:rounded-full">
            {tool === "link" ? (
              <Spline
                className="size-4 shrink-0 text-accent"
                aria-hidden="true"
              />
            ) : tool === "pen" ? (
              <Pencil
                className="size-4 shrink-0 text-foreground"
                aria-hidden="true"
              />
            ) : tool === "shape" ? (
              <Square
                className="size-4 shrink-0 text-foreground"
                aria-hidden="true"
              />
            ) : (
              <Eraser
                className="size-4 shrink-0 text-error"
                aria-hidden="true"
              />
            )}

            <p className="min-w-0 text-xs leading-snug text-muted-foreground max-sm:hidden">
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
                  : tool === "pen"
                    ? "Arraste para desenhar."
                    : tool === "shape"
                      ? "Arraste para criar a forma."
                      : "Passe por cima para tirar da lousa."}
              </span>{" "}
              <span className="hidden sm:inline">
                {tool === "link"
                  ? linkTarget && linkOrigin
                    ? `Destino: “${shortTitle(titleOf(linkTarget))}”.`
                    : "Passe sobre uma nota e toque para confirmar."
                  : tool === "pen" || tool === "shape"
                    ? "O desenho é salvo quando você solta."
                    : "Notas e arquivos continuam na sua conta."}
              </span>
            </p>

            {(tool === "pen" || tool === "shape") && (
              <>
                {tool === "shape" && (
                  <div
                    className="flex items-center gap-0.5 border-l border-border pl-2"
                    role="group"
                    aria-label="Tipo de forma"
                  >
                    {(
                      [
                        ["rectangle", Square, "Retângulo"],
                        ["ellipse", Circle, "Elipse"],
                        ["diamond", Diamond, "Losango"],
                      ] as const
                    ).map(([kind, Icon, label]) => (
                      <button
                        key={kind}
                        type="button"
                        title={label}
                        aria-pressed={shapeKind === kind}
                        onClick={() => setShapeKind(kind)}
                        className={cn(
                          "flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-tertiary hover:text-foreground",
                          shapeKind === kind &&
                            "bg-foreground text-background hover:bg-foreground hover:text-background"
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}
                <div
                  className="flex items-center gap-1 border-l border-border pl-2"
                  role="group"
                  aria-label="Cor do traço"
                >
                  {(
                    ["default", "1", "2", "3", "4", "5", "6"] as BoardMarkTone[]
                  ).map((tone) => (
                    <button
                      key={tone}
                      type="button"
                      title={tone === "default" ? "Cor padrão" : `Cor ${tone}`}
                      aria-label={
                        tone === "default" ? "Cor padrão" : `Cor ${tone}`
                      }
                      aria-pressed={markTone === tone}
                      onClick={() => setMarkTone(tone)}
                      className={cn(
                        "size-7 rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:size-9",
                        markTone === tone
                          ? "border-foreground"
                          : "border-transparent"
                      )}
                      style={{ background: markToneColor(tone) }}
                    />
                  ))}
                </div>
                <label className="flex items-center gap-1 border-l border-border pl-2 text-[10px] text-muted-foreground">
                  <span className="sr-only">Espessura</span>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    value={markWeight}
                    onChange={(event) =>
                      setMarkWeight(Number(event.target.value))
                    }
                    className="w-14 accent-foreground"
                  />
                  <span className="w-3 tabular-nums">{markWeight}</span>
                </label>
              </>
            )}

            {tool === "eraser" && (
              <button
                type="button"
                onClick={() =>
                  armedClear ? clearBoard() : setArmedClear(true)
                }
                onBlur={() => setArmedClear(false)}
                disabled={
                  visibleWindows.length === 0 && visibleMarks.length === 0
                }
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
                  : `Guardar ${tool === "pen" ? "a caneta" : tool === "shape" ? "as formas" : "a borracha"} — Esc`
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
            {zoomPercent}%<span className="sr-only">Voltar a 100%</span>
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

          <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />

          <ZoomButton
            label={zenMode ? "Sair do modo de leitura" : "Modo de leitura"}
            hint={
              zenMode
                ? "Vai mostrar as ferramentas de novo."
                : "Vai esconder tudo, menos o zoom — só para olhar."
            }
            active={zenMode}
            onClick={toggleZenMode}
          >
            <BookOpen className="size-3.5" aria-hidden="true" />
          </ZoomButton>
        </div>

        {(notice || lastErased || atCap) && (
          <div
            role="status"
            onPointerEnter={() => setHeldErase(lastErased)}
            onPointerLeave={() => setHeldErase(null)}
            onFocus={() => setHeldErase(lastErased)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setHeldErase(null);
              }
            }}
            className="absolute bottom-4 left-1/2 z-30 w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl bg-background shadow-[0_16px_40px_-18px_rgba(0,0,0,0.48)] ring-1 ring-border"
          >
            <div className="flex items-start gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">
                {notice ? (
                  <>
                    {notice.message}
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
                  <>
                    <p className="mb-0.5 text-xs font-medium text-subtle-foreground">
                      {undoHeld
                        ? "Desfazer disponível enquanto você estiver aqui"
                        : "Desfazer disponível por 3 segundos"}
                    </p>
                    <p>{eraseSummary(lastErased)}</p>
                  </>
                ) : (
                  // Teto absoluto: não é oferta, é proteção contra abuso.
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
                    setWorkspaceError(null);
                    dismissErased();
                  }}
                  className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Dispensar aviso</span>
                </button>
              )}
            </div>
            {lastErased && !notice && (
              <div
                key={`${lastErased.windows.map((item) => item.id).join(",")}:${lastErased.links.map((item) => `${item.fromWindowId}>${item.toWindowId}`).join(",")}:${lastErased.marks.map((item) => item.id).join(",")}`}
                className="h-1 origin-left bg-accent motion-reduce:hidden"
                style={{
                  animation: `erase-undo-countdown ${ERASE_UNDO_TIMEOUT}ms linear forwards`,
                  animationPlayState: undoHeld ? "paused" : "running",
                }}
              >
                <span className="sr-only">
                  O aviso fecha automaticamente em 3 segundos.
                </span>
              </div>
            )}
          </div>
        )}

        {selectedWindow && (
          <ToolPropertiesPanel
            window={selectedWindow}
            background={background}
            onChange={(patch) => updateWindow(selectedWindow.id, patch)}
            onBackgroundChange={(patch) => void changeBackground(patch)}
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
          openNoteIds={openNoteIds}
          onClose={closePicker}
          onPick={handlePick}
          onPickAttachment={handlePickAttachment}
        />
        <ConfirmDialog
          open={notePendingDelete !== null}
          title="Excluir esta nota?"
          description="Ela sairá da sua conta, da busca e de todas as lousas em que estiver aberta."
          confirmLabel="Excluir nota"
          busyLabel="Excluindo nota…"
          onOpenChange={(open) => {
            if (!open) setNotePendingDelete(null);
          }}
          onConfirm={() => {
            if (notePendingDelete) {
              void deleteNote(notePendingDelete, deleteAttachments);
              setNotePendingDelete(null);
            }
          }}
        >
          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-secondary px-3.5 py-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={deleteAttachments}
              onChange={(event) => setDeleteAttachments(event.target.checked)}
              className="mt-0.5 size-4 accent-error"
            />
            <span>
              <span className="block font-medium">
                Apagar também os arquivos associados
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                Essa escolha remove permanentemente os arquivos enviados junto
                com a nota.
              </span>
            </span>
          </label>
        </ConfirmDialog>
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

interface BoardWindowItemProps {
  item: BoardWindow;
  zoom: number;
  focused: boolean;
  autoFocus: boolean;
  readOnly: boolean;
  onFocus: (id: string) => void;
  onPreview: (id: string, patch: WindowPatch) => void;
  onCommit: (id: string, patch: WindowPatch) => void;
  onClose: (id: string) => void;
  onNoteChange: (noteId: string, patch: NotePatch) => void;
  onAddTag: (noteId: string, name: string) => void;
  onRemoveTag: (noteId: string, tagId: string) => void;
  onUpdateTag: (
    tagId: string,
    patch: { name?: string; color?: string | null }
  ) => void;
  onLinkFrom: (id: string) => void;
  onRaise: (id: string) => void;
  onOpenAttachment: (attachmentId: string) => void;
  onOpenEditor: (noteId: string) => void;
  onDeleteNote: (noteId: string) => void;
  /** As janelas escolhidas pelo marquee — inclusive esta, se estiver dentro. */
  selectedWindowIds: ReadonlySet<string>;
  /** Move o grupo inteiro quando esta janela é a que a pessoa está arrastando. */
  onMoveGroup: (ids: string[], dx: number, dy: number) => void;
  /** Fecha a passada do grupo — a "foto" de origem vale só até aqui. */
  onMoveGroupEnd: () => void;
}

/**
 * Uma janela na lousa: a moldura, o miolo e o menu do botão direito.
 *
 * **Memoizado, e isto é a diferença entre arrastar liso e arrastar
 * engasgado.** Cada quadro de arraste troca o objeto de **uma** janela e
 * re-renderiza o `Board` inteiro; sem o `memo`, as outras vinte janelas
 * renderizavam junto — e uma delas pode ser um TipTap ou um PDF. Mesmo
 * argumento que já valia para `ConnectionArrow`.
 *
 * Para o `memo` valer, todo repasse é uma função **estável** que recebe o
 * `id`: quem monta o fechamento sobre `item` é este componente, uma vez por
 * mudança de verdade, e não o `map` a sessenta quadros por segundo.
 */
const BoardWindowItem = memo(function BoardWindowItem({
  item,
  zoom,
  focused,
  autoFocus,
  readOnly,
  onFocus,
  onPreview,
  onCommit,
  onClose,
  onNoteChange,
  onAddTag,
  onRemoveTag,
  onUpdateTag,
  onLinkFrom,
  onRaise,
  onOpenAttachment,
  onOpenEditor,
  onDeleteNote,
  selectedWindowIds,
  onMoveGroup,
  onMoveGroupEnd,
}: BoardWindowItemProps) {
  const id = item.id;
  const note = item.note;
  const noteId = note?.id ?? null;
  const attachmentId = note?.attachmentId ?? null;

  const focus = useCallback(() => onFocus(id), [onFocus, id]);
  const preview = useCallback(
    (patch: WindowPatch) => onPreview(id, patch),
    [onPreview, id]
  );
  const commit = useCallback(
    (patch: WindowPatch) => onCommit(id, patch),
    [onCommit, id]
  );
  const close = useCallback(() => onClose(id), [onClose, id]);

  return (
    // `display: contents` apaga a caixa deste envelope — as janelas continuam
    // posicionadas em relação ao plano. `pointer-events` é herdada, e é assim
    // que ela chega até a janela sem o envelope virar um alvo.
    <div className="pointer-events-auto contents">
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={readOnly}>
          <WindowFrame
            window={item}
            zoom={zoom}
            title={titleOf(item)}
            label={labelOf(item)}
            icon={
              note ? (
                <NoteTypeIcon
                  type={note.type}
                  className="size-3.5 shrink-0 text-subtle-foreground"
                />
              ) : item.kind === "attachment" ? (
                <Paperclip className="size-3.5 shrink-0 text-subtle-foreground" />
              ) : null
            }
            toneClass={surfaceClassOf(item)}
            focused={focused}
            readOnly={readOnly}
            onFocus={focus}
            onPreview={preview}
            onCommit={commit}
            onClose={close}
            isSelected={selectedWindowIds.has(id)}
            selectedWindowIds={selectedWindowIds}
            onMoveGroup={onMoveGroup}
            onMoveGroupEnd={onMoveGroupEnd}
          >
            {item.kind === "attachment" && item.attachment ? (
              <AttachmentWindowBody
                attachment={item.attachment}
                width={item.width}
              />
            ) : item.kind === "note" ? (
              <NoteWindowBody
                window={item}
                autoFocus={autoFocus}
                readOnly={readOnly}
                onChange={(patch) => noteId && onNoteChange(noteId, patch)}
                onAddTag={(name) => noteId && onAddTag(noteId, name)}
                onRemoveTag={(tagId) => noteId && onRemoveTag(noteId, tagId)}
                onUpdateTag={onUpdateTag}
              />
            ) : (
              <ElementWindowBody
                window={item}
                autoFocus={autoFocus}
                readOnly={readOnly}
                onChange={commit}
                onCommit={commit}
              />
            )}
          </WindowFrame>
        </ContextMenuTrigger>
        <WindowMenu
          window={item}
          onOpenAttachment={
            attachmentId ? () => onOpenAttachment(attachmentId) : undefined
          }
          onOpenEditor={noteId ? () => onOpenEditor(noteId) : undefined}
          onLink={() => onLinkFrom(id)}
          onRaise={() => onRaise(id)}
          onToggleState={() =>
            onCommit(id, {
              state: item.state === "minimized" ? "normal" : "minimized",
            })
          }
          onClose={close}
          onDeleteNote={noteId ? () => onDeleteNote(noteId) : undefined}
        />
      </ContextMenu>
    </div>
  );
});

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
  shortcut,
  disabled,
  expanded,
  wide,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  shortcut?: string;
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
      aria-keyshortcuts={shortcut?.toLowerCase()}
      title={`${label}${shortcut ? ` (${shortcut})` : ""} — ${hint}`}
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
  /** Aceso — o modo de leitura é o único botão daqui que fica ligado. */
  active,
  onClick,
  children,
}: {
  label: string;
  /** O atalho equivalente, quando existe um. */
  hint?: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={hint ? `${label} — ${hint}` : label}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg transition-colors duration-150 hover:bg-tertiary hover:text-foreground disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-10",
        active ? "bg-tertiary text-foreground" : "text-subtle-foreground"
      )}
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

/** Canvas/SVG leem os tokens --nx-*; os --color-* do Tailwind são inline. */
function markToneColor(tone: BoardMarkTone): string {
  return tone === "default"
    ? "var(--nx-text-primary)"
    : `var(--nx-tag-${tone}-text)`;
}

/** O que o cartão de "apagado" diz. */
function eraseSummary(batch: ErasedBatch): string {
  if (
    batch.removed === 0 &&
    batch.connections === 0 &&
    batch.marks.length > 0
  ) {
    return batch.marks.length === 1
      ? "1 desenho removido da lousa."
      : `${batch.marks.length} desenhos removidos da lousa.`;
  }
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

  const drawings =
    batch.marks.length === 0
      ? ""
      : batch.marks.length === 1
        ? " 1 desenho saiu junto."
        : ` ${batch.marks.length} desenhos saíram junto.`;
  return `${what} da lousa. ${fate}${links}${drawings}`;
}

function boundsOfBoard(windows: BoardWindow[], marks: BoardMark[]) {
  const boxes = [
    ...windows.map((item) => ({
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    })),
    ...marks.map((item) => ({
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    })),
  ];
  if (boxes.length === 0) return null;
  return boxes.reduce(
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
