"use client";

import {
  ArrowLeft,
  ExternalLink,
  FileAudio,
  FileImage,
  FileText,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { AttachmentWindowBody } from "@/components/workspace/attachment-window-body";
import type { EditableNote } from "@/lib/notes/queries";
import { cn } from "@/lib/utils";

/**
 * O arquivo de origem, aberto ao lado da nota.
 *
 * É a lousa sem a lousa: o PDF (ou a imagem, ou o áudio) à direita, a nota à
 * esquerda, e a pessoa lê um enquanto escreve na outra — sem trocar de aba.
 * O corpo é o mesmo `AttachmentWindowBody` da janela de anexo e do acervo:
 * mesmo laço de URL assinada renovada, mesmo pdf.js, mesmo player.
 *
 * **Largura e aberto/fechado são do aparelho**, como o zoom do editor: moram
 * no `localStorage` e nunca entram na nota. Quem deixou o painel aberto numa
 * nota derivada o encontra aberto na próxima — só no desktop. No celular o
 * painel cobre a nota inteira, e abrir sozinho esconderia o que a pessoa veio
 * ler.
 */

export type NoteSource = NonNullable<EditableNote["attachment"]>;

const OPEN_KEY = "nexo-note-source-open";
const WIDTH_KEY = "nexo-note-source-width";
const WIDE_QUERY = "(min-width: 1024px)";
const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 320;
/** O que sobra para a nota nunca fica abaixo disto. */
const MIN_NOTE_WIDTH = 440;
const KEY_STEP = 32;

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Sem storage, a escolha vale até sair da página.
  }
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

export function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Aberto/fechado. No desktop é a preferência gravada; no celular é estado
 * desta visita e começa fechado.
 */
export function useSourcePanel(available: boolean) {
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false
  );
  const storedOpen = useSyncExternalStore(
    subscribeStorage,
    () => readStored(OPEN_KEY) === "1",
    () => false
  );
  const [narrowOpen, setNarrowOpen] = useState(false);

  const open = available && (wide ? storedOpen : narrowOpen);

  const setOpen = useCallback(
    (next: boolean) => {
      if (wide) writeStored(OPEN_KEY, next ? "1" : "0");
      else setNarrowOpen(next);
    },
    [wide]
  );

  return { open, setOpen, wide };
}

function clampWidth(value: number, container: number): number {
  const max = Math.max(MIN_WIDTH, container - MIN_NOTE_WIDTH);
  return Math.round(Math.min(max, Math.max(MIN_WIDTH, value)));
}

export function NoteSourcePanel({
  source,
  wide,
  onClose,
}: {
  source: NoteSource;
  wide: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyWidth, setBodyWidth] = useState(DEFAULT_WIDTH);

  const storedWidth = useSyncExternalStore(
    subscribeStorage,
    () => readStored(WIDTH_KEY),
    () => null
  );
  const preferred = Number(storedWidth) || DEFAULT_WIDTH;
  // Largura provisória durante o arraste: gravar a cada pixel dispararia um
  // `storage` por quadro nas outras abas.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const width = clampWidth(dragWidth ?? preferred, containerWidth || 1440);

  // O pdf.js desenha na largura que recebe: acompanha o corpo do painel.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const observer = new ResizeObserver(([entry]) => {
      setBodyWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  // A largura da área inteira (nota + painel), para o teto do arraste.
  useEffect(() => {
    const container = panelRef.current?.parentElement;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;

    function move(next: PointerEvent) {
      // O painel está à direita: puxar a borda para a esquerda o alarga.
      latest = clampWidth(startWidth + (startX - next.clientX), containerWidth);
      setDragWidth(latest);
    }
    function end() {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      writeStored(WIDTH_KEY, String(latest));
      setDragWidth(null);
    }

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function resizeByKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === "ArrowLeft"
        ? KEY_STEP
        : event.key === "ArrowRight"
          ? -KEY_STEP
          : 0;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      writeStored(
        WIDTH_KEY,
        String(
          clampWidth(
            event.key === "Home" ? MIN_WIDTH : Infinity,
            containerWidth
          )
        )
      );
      return;
    }
    if (!delta) return;
    event.preventDefault();
    writeStored(WIDTH_KEY, String(clampWidth(width + delta, containerWidth)));
  }

  // No celular o painel cobre a nota: Esc devolve a nota, como um "voltar".
  useEffect(() => {
    if (wide) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [wide, onClose]);

  async function openInTab() {
    try {
      const response = await fetch(`/api/attachments/${source.id}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as {
        url?: string;
      } | null;
      if (response.ok && body?.url) {
        window.open(body.url, "_blank", "noopener,noreferrer");
      }
    } catch {
      // O painel continua mostrando o arquivo; a aba só não abre.
    }
  }

  const Icon = SOURCE_ICON[source.type] ?? FileText;

  return (
    <aside
      ref={panelRef}
      aria-label={`Arquivo de origem: ${source.filename}`}
      style={wide ? { width } : undefined}
      className={cn(
        "flex min-h-0 flex-col bg-secondary/50 print:hidden",
        wide
          ? "relative shrink-0 border-l border-border"
          : "fixed inset-0 z-40 bg-background"
      )}
    >
      {wide && (
        // A alça é mais larga que a linha que se vê: 1px não se acerta com o
        // mouse, e no toque nem existe.
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Largura do painel do arquivo"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={Math.max(MIN_WIDTH, containerWidth - MIN_NOTE_WIDTH)}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeByKey}
          onDoubleClick={() => writeStored(WIDTH_KEY, String(DEFAULT_WIDTH))}
          className="group/handle absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none"
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 motion-reduce:transition-none",
              "group-hover/handle:bg-subtle-foreground/60 group-focus-visible/handle:bg-foreground",
              dragWidth !== null && "bg-foreground"
            )}
          />
        </div>
      )}

      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2 sm:px-3">
        {!wide && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:h-11"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Nota
          </button>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          <Icon
            className="size-4 shrink-0 text-subtle-foreground"
            aria-hidden="true"
          />
          <p
            className="min-w-0 truncate text-sm font-medium text-foreground"
            title={source.filename}
          >
            {source.filename}
          </p>
          <span className="hidden shrink-0 text-xs tabular-nums text-subtle-foreground sm:inline">
            {describeSource(source)}
          </span>
        </div>

        <button
          type="button"
          onClick={() => void openInTab()}
          title="Abrir em outra aba"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:size-11"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          <span className="sr-only">Abrir {source.filename} em outra aba</span>
        </button>
        {wide && (
          <button
            type="button"
            onClick={onClose}
            title="Fechar o painel"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Fechar o painel do arquivo</span>
          </button>
        )}
      </header>

      <div ref={bodyRef} className="min-h-0 flex-1">
        <AttachmentWindowBody
          key={source.id}
          attachment={source}
          width={bodyWidth}
        />
      </div>
    </aside>
  );
}

const SOURCE_ICON: Record<string, typeof FileText> = {
  pdf: FileText,
  document: FileText,
  image: FileImage,
  audio: FileAudio,
};

const SOURCE_LABEL: Record<string, string> = {
  pdf: "PDF",
  document: "Documento",
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
};

/** "PDF · 2,1 MB" — o que é e quanto pesa, numa linha. */
export function describeSource(source: NoteSource): string {
  const parts = [SOURCE_LABEL[source.type] ?? "Arquivo"];
  if (source.sizeBytes !== null) parts.push(formatSize(source.sizeBytes));
  return parts.join(" · ");
}

function formatSize(bytes: number): string {
  const format = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${format.format(Math.round(bytes / 1024))} KB`;
  return `${format.format(bytes / (1024 * 1024))} MB`;
}
