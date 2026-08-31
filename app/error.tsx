"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ErrorReport } from "@/components/errors/error-report";

/**
 * O que a pessoa vê quando uma tela quebra.
 *
 * Antes disto, um erro de render deixava a tela em branco com o texto padrão
 * do Next — sem nada para fazer, sem nada para dizer ao suporte, e sem nós
 * ficarmos sabendo. Um erro de Server Component então chegava aqui com a
 * mensagem já apagada pelo Next (é assim em produção, de propósito), e o
 * `digest` que sobra é o único fio que ainda liga esta tela ao log do
 * servidor. Ele vai junto no relato.
 *
 * **Nada é enviado sem o clique.** O boundary não reporta sozinho: quem
 * decide mandar o erro é a pessoa. Ver a discussão em `app/api/errors/route.ts`.
 *
 * `retry()` vem antes de tudo porque boa parte das quebras é passageira — uma
 * rebusca que caiu, um deploy no meio da navegação. Insistir uma vez resolve
 * mais casos do que qualquer relato.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-secondary p-6">
      <main className="w-full max-w-md rounded-2xl border border-border bg-background p-8">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Esta tela não carregou
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          O problema é nosso, não seu. Nada do que você guardou foi perdido —
          o que está na sua conta continua lá.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground transition-opacity duration-150 hover:opacity-90"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Tentar de novo
          </button>

          <Link
            href="/dashboard"
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors duration-150 hover:bg-tertiary"
          >
            Voltar ao início
          </Link>
        </div>

        <ErrorReport
          className="mt-6 border-t border-border pt-4"
          route={pathname ?? "app/error"}
          clientError={{
            message: error.message || "Erro sem mensagem",
            stack: error.stack ?? null,
            digest: error.digest,
          }}
        />
      </main>
    </div>
  );
}
