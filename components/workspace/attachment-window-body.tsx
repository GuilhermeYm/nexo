"use client";

import { Download, FileText, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { PdfViewer } from "@/components/workspace/pdf-viewer";
import type { BoardAttachment } from "@/lib/workspace/queries";

/**
 * O arquivo em si, dentro da janela.
 *
 * Até aqui a lousa só sabia mostrar o que a IA escreveu **sobre** o
 * documento. Esta janela mostra o documento.
 *
 * A URL é assinada e de vida curta, pedida sob demanda a
 * `/api/attachments/[id]`. Ela nunca vem junto com a lista de janelas: seria
 * um segredo portátil viajando em toda leitura da lousa, inclusive nas que
 * acontecem porque outro dispositivo mexeu em alguma coisa.
 */

interface AttachmentBodyProps {
  attachment: BoardAttachment;
  /** Largura interna da janela, em pixels de lousa. */
  width: number;
}

export function AttachmentWindowBody({
  attachment,
  width,
}: AttachmentBodyProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** Incrementado pelo "tentar de novo": reinicia o laço abaixo. */
  const [attempt, setAttempt] = useState(0);

  /**
   * O laço que mantém a URL válida.
   *
   * Um efeito só, e não um para buscar e outro para renovar: a renovação é a
   * mesma busca, agendada. Um áudio longo passa da validade no meio da
   * reprodução, e aí o próximo pedaço volta 400 — renovar meio minuto antes
   * de expirar é mais barato que explicar por que o som parou.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      try {
        const response = await fetch(`/api/attachments/${attachment.id}`, {
          cache: "no-store",
        });
        if (cancelled) return;

        if (!response.ok) {
          setFailed(true);
          return;
        }

        const body = await response.json();
        if (cancelled) return;

        setFailed(false);
        setUrl(body.url);

        const lifetimeMs = (body.expiresIn ?? 900) * 1000;
        timer = setTimeout(refresh, Math.max(30_000, lifetimeMs - 30_000));
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    timer = setTimeout(refresh, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attachment.id, attempt]);

  async function download() {
    const response = await fetch(
      `/api/attachments/${attachment.id}?download=1`,
      {
        cache: "no-store",
      }
    );
    if (!response.ok) return;
    const body = await response.json();
    // O `download` do Supabase já vem no cabeçalho da URL assinada; abrir
    // numa aba deixa o navegador cuidar do resto.
    window.open(body.url, "_blank", "noopener,noreferrer");
  }

  if (failed) {
    return (
      <Shell attachment={attachment} onDownload={download}>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Não foi possível abrir o arquivo agora. Ele continua guardado.
        </p>
        <button
          type="button"
          onClick={() => setAttempt((current) => current + 1)}
          onPointerDown={(event) => event.stopPropagation()}
          className="mt-3 text-sm font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          Tentar de novo
        </button>
      </Shell>
    );
  }

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderCircle
          aria-hidden="true"
          className="size-5 animate-spin text-subtle-foreground motion-reduce:animate-none"
        />
        <span className="sr-only">Abrindo {attachment.filename}</span>
      </div>
    );
  }

  if (attachment.type === "pdf") {
    return <PdfViewer url={url} width={Math.max(120, width - 16)} />;
  }

  if (attachment.type === "audio") {
    return (
      <Shell attachment={attachment} onDownload={download}>
        {/* `media-src` do CSP já libera o domínio do Supabase — o áudio toca
            direto da URL assinada, sem passar por nós. */}
        <audio
          controls
          preload="metadata"
          src={url}
          onPointerDown={(event) => event.stopPropagation()}
          className="mt-2 w-full"
        />
      </Shell>
    );
  }

  if (isPlainText(attachment.mimeType)) {
    return <TextViewer url={url} filename={attachment.filename} />;
  }

  return (
    <Shell attachment={attachment} onDownload={download}>
      {/* Um .docx não tem visualização honesta sem trazer um conversor
          inteiro para o cliente. Dizer isso e oferecer o download é melhor
          que renderizar XML cru e chamar de pré-visualização. */}
      <p className="text-sm leading-relaxed text-muted-foreground">
        Este formato ainda não abre aqui dentro. Baixe para ler no aplicativo de
        sempre — a nota ao lado tem o resumo que a Nexo escreveu.
      </p>
    </Shell>
  );
}

/* ---------------------------------------------------------------------- */

/** Cabeçalho comum: nome, tamanho e o botão de baixar. */
function Shell({
  attachment,
  onDownload,
  children,
}: {
  attachment: BoardAttachment;
  onDownload: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="flex items-start gap-2.5">
        <FileText
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-subtle-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {attachment.filename}
          </p>
          <p className="mt-0.5 text-xs text-subtle-foreground">
            {formatSize(attachment.sizeBytes)}
          </p>
        </div>
        <button
          type="button"
          onClick={onDownload}
          onPointerDown={(event) => event.stopPropagation()}
          title="Baixar o arquivo"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground pointer-coarse:size-10"
        >
          <Download className="size-4" aria-hidden="true" />
          <span className="sr-only">Baixar {attachment.filename}</span>
        </button>
      </div>

      <div className="mt-3 min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** Texto puro e Markdown: buscados e mostrados como estão. */
function TextViewer({ url, filename }: { url: string; filename: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetch(url)
      .then((response) => (response.ok ? response.text() : ""))
      .then((body) => {
        // Um .txt de 25MB travaria a janela; o começo já responde à
        // pergunta "o que tem aqui dentro".
        if (!cancelled) setText(body.slice(0, 200_000));
      })
      .catch(() => {
        if (!cancelled) setText("");
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (text === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderCircle
          aria-hidden="true"
          className="size-5 animate-spin text-subtle-foreground motion-reduce:animate-none"
        />
        <span className="sr-only">Lendo {filename}</span>
      </div>
    );
  }

  return (
    <pre className="h-full overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
      {text || "Arquivo vazio."}
    </pre>
  );
}

function isPlainText(mimeType: string): boolean {
  return mimeType === "text/plain" || mimeType === "text/markdown";
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "tamanho desconhecido";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
