"use client";

import { useState } from "react";

/**
 * O andar de baixo do tratamento de erro: quando o próprio layout raiz quebra.
 *
 * `app/error.tsx` cobre tudo o que está **dentro** do layout; quando é o
 * layout que falha, não sobra nada — este arquivo substitui o documento
 * inteiro. Duas consequências que moldam o código abaixo, e as duas vêm da
 * documentação do Next:
 *
 * - **Ele monta o próprio `<html>` e `<body>`.**
 * - **O CSS global não chega aqui.** Nenhuma classe do Tailwind existe nesta
 *   árvore, nem os tokens de tema. Por isso tudo é estilo em linha, com as
 *   duas paletas escritas à mão e escolhidas por `prefers-color-scheme` —
 *   `data-theme` também não chega, então a preferência explícita da pessoa
 *   não tem como ser respeitada nesta tela.
 *
 * O CSP do `proxy.ts` permite `style-src 'unsafe-inline'`, então estilo em
 * linha passa; script em linha não passaria, e não há nenhum.
 *
 * Pelo mesmo motivo o relato é reescrito aqui em vez de importar
 * `<ErrorReport>`: o componente é feito de classes que esta página não tem.
 * A rota que ele chama é a mesma.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle"
  );
  const [code, setCode] = useState<string | null>(null);
  const [text, setText] = useState("");

  async function send() {
    setPhase("sending");
    try {
      const response = await fetch("/api/errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error.message || "Erro no layout raiz",
          stack: error.stack ?? undefined,
          digest: error.digest,
          kind: "unhandled",
          route: "app/global-error",
          report: text.trim() || undefined,
        }),
      });
      if (!response.ok) {
        setPhase("failed");
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        code?: unknown;
      } | null;
      if (typeof body?.code === "string") setCode(body.code);
      setPhase("sent");
    } catch {
      setPhase("failed");
    }
  }

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0 }}>
        <title>Erro — Nexo</title>

        <style>{`
          :root { color-scheme: light dark; }
          .nx-shell {
            min-height: 100dvh; display: flex; align-items: center;
            justify-content: center; padding: 24px;
            background: #f7f3ec; color: #2c2a26;
            font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
          }
          .nx-card {
            width: 100%; max-width: 26rem; padding: 32px;
            border: 1px solid #e8e2d9; border-radius: 16px; background: #fdfbf7;
          }
          .nx-muted { color: #6b6356; }
          .nx-field {
            width: 100%; box-sizing: border-box; margin-top: 8px; padding: 8px 10px;
            border: 1px solid #e8e2d9; border-radius: 8px;
            background: #fdfbf7; color: inherit; font: inherit; font-size: 13px;
          }
          .nx-button {
            padding: 8px 12px; border: 0; border-radius: 8px; cursor: pointer;
            background: #3d3b36; color: #fdfbf7; font: inherit; font-size: 14px;
          }
          .nx-ghost {
            padding: 8px 12px; border: 1px solid #e8e2d9; border-radius: 8px;
            cursor: pointer; background: transparent; color: inherit;
            font: inherit; font-size: 14px;
          }
          .nx-code {
            font-family: ui-monospace, SFMono-Regular, monospace;
            letter-spacing: 0.04em;
          }
          @media (prefers-color-scheme: dark) {
            .nx-shell { background: #18181b; color: #eaeaea; }
            .nx-card { background: #0f0f11; border-color: #2a2a2e; }
            .nx-muted { color: #a0a0a8; }
            .nx-field { background: #0f0f11; border-color: #2a2a2e; }
            .nx-button { background: #eaeaea; color: #0f0f11; }
            .nx-ghost { border-color: #2a2a2e; }
          }
        `}</style>

        <div className="nx-shell">
          <main className="nx-card">
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              A Nexo não conseguiu abrir
            </h1>

            <p
              className="nx-muted"
              style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6 }}
            >
              O problema é nosso. Nada do que você guardou foi perdido.
            </p>

            <div style={{ marginTop: 24, display: "flex", gap: 8 }}>
              <button type="button" className="nx-button" onClick={() => retry()}>
                Tentar de novo
              </button>
              <a className="nx-ghost" href="/dashboard">
                Voltar ao início
              </a>
            </div>

            <div
              style={{
                marginTop: 24,
                paddingTop: 16,
                borderTop: "1px solid currentColor",
                borderTopColor: "#e8e2d9",
              }}
            >
              {phase === "sent" ? (
                <p className="nx-muted" style={{ margin: 0, fontSize: 12 }}>
                  Recebemos, obrigado.
                  {code ? (
                    <>
                      {" "}
                      Guarde o código <span className="nx-code">{code}</span>.
                    </>
                  ) : null}
                </p>
              ) : (
                <>
                  <label
                    className="nx-muted"
                    style={{ fontSize: 12 }}
                    htmlFor="nx-report"
                  >
                    O que você estava fazendo? (opcional)
                  </label>
                  <textarea
                    id="nx-report"
                    className="nx-field"
                    rows={2}
                    maxLength={2000}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                  />
                  <button
                    type="button"
                    className="nx-button"
                    style={{ marginTop: 8, fontSize: 13 }}
                    disabled={phase === "sending"}
                    onClick={() => void send()}
                  >
                    {phase === "sending" ? "Enviando…" : "Reportar este erro"}
                  </button>
                  {phase === "failed" && (
                    <p className="nx-muted" style={{ fontSize: 12 }}>
                      Não deu para enviar agora.
                    </p>
                  )}
                </>
              )}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
