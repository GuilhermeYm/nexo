/**
 * Script inline que roda apenas na navegação "dura" (carga inicial, refresh).
 *
 * No servidor sai como `text/javascript` e o browser o executa durante o parse
 * do HTML. No cliente sai como `text/plain`: scripts inseridos via DOM nunca
 * são executados pelo React, e renderizá-los como script gera aviso em
 * desenvolvimento. `suppressHydrationWarning` cobre a diferença do `type`.
 */
export function InlineScript({
  html,
  nonce,
}: {
  html: string;
  /** Nonce do CSP gerado no proxy.ts; sem ele o script-src bloqueia o script. */
  nonce?: string;
}) {
  return (
    <script
      nonce={nonce}
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
