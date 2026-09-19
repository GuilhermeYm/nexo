"use client";

import { Download, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { AttachmentWindowBody } from "@/components/workspace/attachment-window-body";
import type { AttachmentListItem } from "@/lib/attachments/list";

/**
 * O arquivo aberto por cima do acervo.
 *
 * Reaproveita o corpo da janela de anexo da lousa: o mesmo laço de URL
 * assinada renovada, o mesmo pdf.js, o mesmo player de áudio. A URL nunca vem
 * com a lista — é pedida a `/api/attachments/[id]` quando o diálogo abre.
 *
 * O `<dialog>` nativo põe a superfície no top layer, prende o foco e devolve
 * ao botão "Abrir" ao fechar.
 */
export function FileViewerDialog({
  attachment,
  onClose,
}: {
  attachment: AttachmentListItem | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (attachment && !dialog.open) dialog.showModal();
    if (!attachment && dialog.open) dialog.close();
  }, [attachment]);

  // O pdf.js desenha na largura que recebe: acompanha o diálogo, que muda
  // entre celular e desktop e ao girar a tela.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !attachment) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [attachment]);

  async function download() {
    if (!attachment) return;
    const response = await fetch(`/api/attachments/${attachment.id}?download=1`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    const body = await response.json();
    window.open(body.url, "_blank", "noopener,noreferrer");
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={() => {
        if (attachment) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto h-[min(52rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-4xl overflow-clip rounded-2xl bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/55"
    >
      {attachment && (
        <div className="flex h-full flex-col">
          <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
            <h2
              id={titleId}
              className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
              title={attachment.filename}
            >
              {attachment.filename}
            </h2>
            <button
              type="button"
              onClick={() => void download()}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:size-11"
            >
              <Download className="size-4" aria-hidden="true" />
              <span className="sr-only">Baixar {attachment.filename}</span>
            </button>
            <button
              type="button"
              autoFocus
              onClick={onClose}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:size-11"
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Fechar</span>
            </button>
          </header>
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto bg-secondary/40">
            <AttachmentWindowBody
              key={attachment.id}
              attachment={attachment}
              width={width}
            />
          </div>
        </div>
      )}
    </dialog>
  );
}
