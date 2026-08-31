"use client";

import { Check, Copy, Send } from "lucide-react";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * O código do erro na tela, e o caminho para a pessoa contar o que aconteceu.
 *
 * ## Por que isto existe
 *
 * "Erro interno. Tente novamente." é uma frase que não deixa nada para a
 * pessoa fazer além de tentar de novo e falhar de novo. Quando ela escreve
 * para o suporte, escreve "não funciona" — porque é literalmente tudo o que a
 * tela disse —, e do outro lado ninguém consegue ligar aquela frase ao que o
 * servidor viu naquele minuto. O código fecha esse vão nos dois sentidos: ele
 * dá à pessoa uma coisa concreta para citar, e dá ao suporte uma linha para
 * consultar.
 *
 * ## Duas origens, um componente
 *
 * - **A rota falhou.** O servidor já cunhou o código e o mandou no corpo da
 *   resposta (`errorResponse(500, …, code)`); o relato entra por
 *   `PATCH /api/errors/[code]`.
 * - **O navegador quebrou.** Não existe linha nenhuma ainda; o relato e o
 *   erro vão juntos por `POST /api/errors`, e o código volta de lá.
 *
 * A diferença aparece na ordem em que as coisas surgem na tela — com código
 * pronto ele fica visível desde o primeiro instante; sem, ele só aparece
 * depois do envio. Nunca se mostra um código que não existe no banco.
 *
 * ## O tom
 *
 * Sem vermelho e sem "algo deu errado" em negrito. Vermelho é o que a
 * interface usa para dizer "você quebrou alguma coisa", e aqui é o contrário:
 * quem falhou fomos nós. O mesmo princípio que faz recusa por teto de plano
 * sair sem cara de defeito, aplicado ao caso em que houve defeito mesmo.
 */

type Phase = "idle" | "writing" | "sending" | "sent" | "failed";

export interface ClientErrorPayload {
  message: string;
  stack?: string | null;
  digest?: string;
  kind?: "client" | "unhandled";
}

interface ErrorReportProps {
  /** Código vindo do servidor. Quando existe, o relato é um `PATCH`. */
  code?: string | null;
  /** O erro do navegador. Quando existe, o relato é um `POST` que cunha o código. */
  clientError?: ClientErrorPayload;
  /** Onde a pessoa estava — `/api/attachments`, `dashboard/page`… */
  route: string;
  /** Numa faixa estreita (o aviso de rodapé), o formulário vira uma linha. */
  compact?: boolean;
  /**
   * Onde o código já está na tela por outro motivo — a lista de "Meus erros"
   * o mostra em cada linha —, mostrá-lo de novo aqui seria dizer a mesma
   * coisa duas vezes a 20px de distância.
   */
  showCode?: boolean;
  className?: string;
}

const MAX_REPORT = 2000;

export function ErrorReport({
  code: initialCode,
  clientError,
  route,
  compact = false,
  showCode = true,
  className,
}: ErrorReportProps) {
  const [code, setCode] = useState<string | null>(initialCode ?? null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");

  // Sem código e sem erro de cliente não há o que reportar: a rota recusou por
  // validação, por 404, por teto de plano. Nenhum desses é defeito nosso, e
  // oferecer "reportar" neles ensinaria a pessoa a abrir chamado sobre o
  // produto funcionando como deve.
  if (!code && !clientError) return null;

  async function send() {
    const report = text.trim();
    if (report.length === 0) return;

    setPhase("sending");

    try {
      const response = code
        ? await fetch(`/api/errors/${code}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ report }),
          })
        : await fetch("/api/errors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: clientError?.message ?? "Erro no navegador",
              stack: clientError?.stack ?? undefined,
              digest: clientError?.digest,
              kind: clientError?.kind ?? "client",
              route,
              report,
            }),
          });

      if (!response.ok) {
        setPhase("failed");
        return;
      }

      // No caminho do `POST` é a resposta que traz o código — é a primeira
      // vez que ele existe.
      if (!code) {
        const body = (await response.json().catch(() => null)) as {
          code?: unknown;
        } | null;
        if (typeof body?.code === "string") setCode(body.code);
      }

      setPhase("sent");
    } catch {
      setPhase("failed");
    }
  }

  if (phase === "sent") {
    return (
      <div className={cn("text-xs text-muted-foreground", className)}>
        <p>Recebemos. Obrigado — isso ajuda de verdade.</p>
        {code && showCode && (
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span>Guarde o código:</span>
            <ErrorCodeChip code={code} />
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={cn("text-xs text-muted-foreground", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {code && showCode && (
          <>
            <span>Código:</span>
            <ErrorCodeChip code={code} />
          </>
        )}

        {phase !== "writing" && (
          <button
            type="button"
            onClick={() => setPhase("writing")}
            className="rounded-md px-1.5 py-0.5 underline decoration-dotted underline-offset-2 transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
          >
            {code ? "Reportar" : "Reportar este erro"}
          </button>
        )}
      </div>

      {phase === "writing" || phase === "sending" || phase === "failed" ? (
        <div className={cn("mt-2", compact ? "flex items-start gap-1.5" : "")}>
          <label className="sr-only" htmlFor="nexo-error-report">
            O que você estava fazendo?
          </label>
          <textarea
            id="nexo-error-report"
            autoFocus
            value={text}
            maxLength={MAX_REPORT}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter envia; Shift+Enter quebra linha. O campo é de duas ou
              // três frases — exigir o mouse para uma delas é desproporcional.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
              if (event.key === "Escape") setPhase("idle");
            }}
            rows={compact ? 1 : 2}
            placeholder="O que você estava fazendo?"
            className="min-w-0 flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-subtle-foreground focus-visible:border-accent"
          />

          <div
            className={cn(
              "flex items-center gap-1.5",
              compact ? "" : "mt-1.5 justify-end"
            )}
          >
            <button
              type="button"
              onClick={() => setPhase("idle")}
              className="rounded-md px-2 py-1 transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={phase === "sending" || text.trim().length === 0}
              className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-accent-foreground transition-opacity duration-150 disabled:opacity-40"
            >
              <Send className="size-3" aria-hidden="true" />
              {phase === "sending" ? "Enviando…" : "Enviar"}
            </button>
          </div>

          {phase === "failed" && (
            <p className="mt-1.5 basis-full text-subtle-foreground">
              Não deu para enviar agora. O código acima continua valendo.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * O código, copiável.
 *
 * Monoespaçado porque ele é para ser lido caractere a caractere, e com um
 * botão de copiar porque digitar sete símbolos à mão num e-mail é onde o
 * primeiro erro de transcrição aparece. Ditar por telefone continua sendo o
 * caso principal — foi por isso que o alfabeto perdeu as vogais e os pares
 * ambíguos (ver `lib/errors/code.ts`).
 */
export function ErrorCodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sem permissão de área de transferência (contexto não seguro, ou o
      // usuário recusou) o código continua na tela para ler. Não há o que
      // avisar: a alternativa já está visível.
    }
  }, [code]);

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Copiar o código"
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-tertiary px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-foreground transition-colors duration-150 hover:border-accent"
    >
      {code}
      {copied ? (
        <Check className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <Copy className="size-3 shrink-0 opacity-60" aria-hidden="true" />
      )}
      <span className="sr-only">{copied ? "Copiado" : "Copiar o código"}</span>
    </button>
  );
}
