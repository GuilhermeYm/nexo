"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

import { readApiFailure } from "@/lib/api-failure";
import {
  DEFAULT_WINDOW_SIZE,
  imageWindowSize,
} from "@/lib/workspace/window-sizes";

/**
 * Pôr um arquivo do computador (ou do celular) direto na lousa.
 *
 * Três portas, um caminho: arrastar e soltar, colar (Ctrl+V de um print) e o
 * botão da barra — o único que existe no celular. Os três sobem o arquivo por
 * `POST /api/attachments`, o mesmo upload da barra do dashboard (validação de
 * MIME e de assinatura, nota da IA, tarefa no painel), e abrem a janela de
 * anexo onde a pessoa soltou, ou no meio do que ela está vendo.
 *
 * O arquivo entra na conta, não só na lousa: fechar a janela depois não o
 * apaga — mesma regra de qualquer anexo. Ver docs/IMAGENS.md.
 */

/** O que o upload aceita — espelho de `MIME_TO_TYPE` da rota. */
export const BOARD_UPLOAD_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.md,.docx,.mp3,.wav,.m4a";

const ACCEPTED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "audio/x-m4a",
]);

/** Várias soltas de uma vez caem em escada, e não uma exatamente sobre a outra. */
const CASCADE_STEP = 32;

interface Rect {
  width: number;
  height: number;
}

interface UseBoardUploadsOptions {
  /** Falso no modo de leitura e com a lousa no teto de elementos. */
  enabled: boolean;
  /** Tela → lousa, já descontada a moldura. */
  toBoardPoint: (clientX: number, clientY: number) => { x: number; y: number };
  /** O meio do que está sendo visto, em coordenadas de lousa. */
  viewCenter: () => { x: number; y: number };
  /** Abre a janela do anexo recém-enviado, com o canto e o tamanho dados. */
  place: (attachmentId: string, at: { x: number; y: number }, size: Rect | null) => Promise<void>;
  /** Uma frase para o cartão de aviso da lousa. */
  onError: (message: string) => void;
}

export function useBoardUploads({
  enabled,
  toBoardPoint,
  viewCenter,
  place,
  onError,
}: UseBoardUploadsOptions) {
  /** O nome do arquivo subindo agora — o que o aviso "Enviando…" mostra. */
  const [sending, setSending] = useState<string | null>(null);
  /** Um arquivo está sendo arrastado por cima da lousa. */
  const [dropping, setDropping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  const placeFiles = useCallback(
    async (files: File[], anchor: { x: number; y: number } | null) => {
      if (!enabled || files.length === 0 || busy.current) return;

      const accepted = files.filter((file) => ACCEPTED_MIME.has(file.type));
      if (accepted.length < files.length) {
        onError(
          "Alguns arquivos não entram: a lousa aceita imagem (JPG, PNG, WebP, GIF), PDF, texto, .docx e áudio."
        );
      }
      if (accepted.length === 0) return;

      busy.current = true;
      const origin = anchor ?? viewCenter();
      try {
        // Um de cada vez: o upload tem teto por hora, e a ordem de chegada é
        // a ordem da escada na lousa.
        for (const [index, file] of accepted.entries()) {
          setSending(file.name);
          const size = await measure(file);
          const box = size ?? DEFAULT_WINDOW_SIZE.attachment;
          const at = {
            x: Math.round(origin.x - box.width / 2) + index * CASCADE_STEP,
            y: Math.round(origin.y - box.height / 2) + index * CASCADE_STEP,
          };

          const body = new FormData();
          body.append("file", file);
          const response = await fetch("/api/attachments", { method: "POST", body });
          if (!response.ok) {
            const failure = await readApiFailure(
              response,
              response.status === 429
                ? "Limite de envios por hora atingido."
                : "Não foi possível enviar o arquivo."
            );
            onError(`${file.name}: ${failure.message}`);
            // O teto por hora vale para os próximos também — não adianta insistir.
            if (response.status === 429) break;
            continue;
          }

          const payload = (await response.json().catch(() => null)) as {
            attachment?: { id?: string };
          } | null;
          const attachmentId = payload?.attachment?.id;
          if (attachmentId) await place(attachmentId, at, size);
        }
      } catch {
        onError("Sem conexão. O arquivo não foi enviado.");
      } finally {
        busy.current = false;
        setSending(null);
      }
    },
    [enabled, onError, place, viewCenter]
  );

  /* --- Arrastar e soltar -------------------------------------------- */

  const dropHandlers = {
    onDragOver(event: DragEvent<HTMLElement>) {
      if (!enabled || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!dropping) setDropping(true);
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      // `dragleave` dispara a cada filho atravessado; só conta sair da moldura.
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDropping(false);
      }
    },
    onDrop(event: DragEvent<HTMLElement>) {
      if (!enabled || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDropping(false);
      void placeFiles(
        [...event.dataTransfer.files],
        toBoardPoint(event.clientX, event.clientY)
      );
    },
  };

  /* --- Colar ---------------------------------------------------------- */

  // Um print copiado (Print Screen, Cmd+Shift+4) chega como arquivo no
  // `paste`. Dentro de um campo de texto a colagem é do campo — o editor da
  // nota tem a dele, e roubar o Ctrl+V de quem está escrevendo seria pior
  // que não ter o atalho.
  useEffect(() => {
    if (!enabled) return;
    function onPaste(event: ClipboardEvent) {
      // O alvo pode ser o `document` ou a própria `window` (colar sem nada
      // focado) — nenhum dos dois tem `closest`.
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest("input, textarea, [contenteditable='true'], [contenteditable='']") ||
        document.querySelector("dialog[open]")
      ) {
        return;
      }
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0) return;
      event.preventDefault();
      void placeFiles(files, null);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enabled, placeFiles]);

  /* --- O botão da barra ------------------------------------------------ */

  const pickFiles = useCallback(() => inputRef.current?.click(), []);

  const inputProps = {
    ref: inputRef,
    type: "file" as const,
    multiple: true,
    accept: BOARD_UPLOAD_ACCEPT,
    className: "hidden",
    onChange(event: React.ChangeEvent<HTMLInputElement>) {
      const files = [...(event.target.files ?? [])];
      // Limpo na hora: escolher o mesmo arquivo de novo precisa disparar.
      event.target.value = "";
      void placeFiles(files, null);
    },
  };

  return { sending, dropping, dropHandlers, pickFiles, inputProps };
}

/**
 * O tamanho que a janela da imagem vai ter — medido aqui para a janela
 * nascer centrada onde a pessoa soltou. O servidor chegaria à mesma medida
 * pelo que gravou no upload; medir no cliente só evita esperar por ele.
 */
async function measure(file: File): Promise<Rect | null> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") {
    return null;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const size = imageWindowSize({ width: bitmap.width, height: bitmap.height });
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}
