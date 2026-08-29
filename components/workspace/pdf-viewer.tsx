"use client";

import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
// Tipos apagados na compilação: nenhum byte do pdf.js entra no pacote por
// causa desta linha — quem o carrega é o `import()` dinâmico lá embaixo.
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";

import { cn } from "@/lib/utils";

/**
 * O PDF desenhado em canvas, pelo pdf.js.
 *
 * **Por que não um `<iframe>` com o visualizador do navegador.** Três razões,
 * em ordem de peso:
 *
 * 1. O CSP deste projeto não declara `frame-src`, então ele cai em
 *    `default-src 'self'` e um quadro apontando para o Supabase seria
 *    bloqueado. Abrir essa porta só para exibir um PDF é preço alto.
 * 2. No iOS um PDF dentro de `<iframe>` mostra só a primeira página, e em
 *    boa parte dos Android nem isso. O produto se compromete com
 *    multiplataforma; um visualizador que só existe no desktop não cumpre.
 * 3. A barra do visualizador nativo — zoom, impressão, miniaturas — dentro de
 *    uma janela de 340px come mais espaço do que o documento.
 *
 * O pdf.js entra por importação dinâmica: quem nunca abre um PDF não paga
 * pelos ~350 KB dele. O worker vem do nosso próprio domínio, então continua
 * valendo `default-src 'self'` — nenhuma diretiva precisou ser afrouxada.
 */

interface PdfViewerProps {
  /** URL assinada, de vida curta. */
  url: string;
  /** Largura disponível, em pixels de lousa: a página é ajustada a ela. */
  width: number;
}

type Status = "loading" | "ready" | "error";

export function PdfViewer({ url, width }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // O documento aberto e a pintura em andamento. Ficam em ref porque nada
  // aqui precisa causar render — e porque a pintura anterior tem de ser
  // cancelada antes da próxima começar, ou as duas escrevem no mesmo canvas.
  //
  // Quem sabe se desfazer é a *tarefa de carregamento*, não o documento: é
  // ela que abortou as requisições de rede e desliga o worker.
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const renderRef = useRef<RenderTask | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function open() {
      setStatus("loading");
      try {
        const pdfjs = await import("pdfjs-dist");
        // Servido do nosso domínio pelo bundler — é isso que mantém o
        // `worker-src` herdando `default-src 'self'`.
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const task = pdfjs.getDocument({ url });
        taskRef.current = task;
        const doc = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }

        documentRef.current = doc;
        setTotal(doc.numPages);
        setPage(1);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void open();

    return () => {
      cancelled = true;
      renderRef.current?.cancel();
      renderRef.current = null;
      void taskRef.current?.destroy();
      taskRef.current = null;
      documentRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    const doc = documentRef.current;
    const canvas = canvasRef.current;
    if (status !== "ready" || !doc || !canvas || width <= 0) return;

    let cancelled = false;

    // Documento e canvas entram por parâmetro em vez de virem do escopo: a
    // checagem acima já garantiu que existem, e passá-los adiante evita ter
    // de reafirmar isso com `!` a cada uso lá dentro.
    async function paint(doc: PDFDocumentProxy, canvas: HTMLCanvasElement) {
      try {
        // Uma pintura por vez no mesmo canvas.
        renderRef.current?.cancel();

        const target = await doc.getPage(page);

        // A página se ajusta à largura da janela, e o canvas é desenhado na
        // densidade da tela — senão o texto sai borrado em telas retina.
        const base = target.getViewport({ scale: 1 });
        const scale = width / base.width;
        const viewport = target.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);

        const task = target.render({ canvas, canvasContext: context, viewport });
        renderRef.current = task;
        await task.promise;
        renderRef.current = null;
      } catch {
        // Cancelamento é o caso comum aqui — trocar de página ou
        // redimensionar aborta a pintura anterior de propósito.
        if (!cancelled) return;
      }
    }

    void paint(doc, canvas);

    return () => {
      cancelled = true;
    };
  }, [status, page, width]);

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderCircle
          aria-hidden="true"
          className="size-5 animate-spin text-subtle-foreground motion-reduce:animate-none"
        />
        <span className="sr-only">Abrindo o documento</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <p className="flex h-full items-center justify-center px-6 text-center text-sm leading-relaxed text-muted-foreground">
        Não foi possível abrir este PDF. O arquivo continua guardado — tente
        baixá-lo pelo menu da janela.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto bg-tertiary p-2">
        <canvas
          ref={canvasRef}
          // O canvas carrega o documento inteiro em pixels; o nome
          // acessível é o que um leitor de tela tem para trabalhar aqui.
          role="img"
          aria-label={`Página ${page} de ${total}`}
          className="mx-auto rounded border border-border bg-background shadow-sm"
        />
      </div>

      {total > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-1 border-t border-border/60 px-2 py-1.5">
          <PageButton
            label="Página anterior"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </PageButton>
          <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-muted-foreground">
            {page} / {total}
          </span>
          <PageButton
            label="Próxima página"
            disabled={page >= total}
            onClick={() => setPage((current) => Math.min(total, current + 1))}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </PageButton>
        </div>
      )}
    </div>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      // A barra de título é área de arraste; sem isto o `pointerdown` do
      // botão viraria o começo de um gesto de mover a janela.
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-subtle-foreground transition-colors duration-150",
        "hover:bg-tertiary hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        "pointer-coarse:size-9"
      )}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}
