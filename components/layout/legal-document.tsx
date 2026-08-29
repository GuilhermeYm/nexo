import type { ReactNode } from "react";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

interface LegalDocumentProps {
  title: string;
  summary: string;
  /** Data da última revisão, já escrita por extenso em pt-BR. */
  updatedAt: string;
  children: ReactNode;
}

/**
 * Terreno de leitura para os documentos de serviço.
 *
 * O resto da landing é modo persuasão; aqui o objetivo é o oposto — a pessoa
 * veio conferir, não ser convencida. Por isso: uma coluna só, medida de ~68
 * caracteres, e nenhuma animação. As sub-seções são numeradas porque a
 * numeração aqui é endereço: dá para citar "item 4" num e-mail.
 */
export function LegalDocument({
  title,
  summary,
  updatedAt,
  children,
}: LegalDocumentProps) {
  return (
    <>
      <Navbar />
      <main className="bg-background pt-36 pb-24 sm:pt-44">
        <article className="mx-auto max-w-2xl px-6">
          <header className="border-b border-border pb-10">
            <h1 className="text-4xl font-bold tracking-[-0.03em] text-balance text-foreground font-[family-name:var(--font-display)] sm:text-5xl">
              {title}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              {summary}
            </p>
            <p className="mt-6 text-sm text-subtle-foreground">
              Última atualização: {updatedAt}
            </p>
          </header>

          <div
            className={[
              "mt-12 flex flex-col gap-10",
              // Tipografia do corpo do documento, aplicada por descendência
              // para o conteúdo de cada página ficar sendo só o texto.
              "[&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-[-0.01em] [&_h2]:text-foreground [&_h2]:font-[family-name:var(--font-display)]",
              "[&_h2]:mb-3",
              "[&_p]:text-base [&_p]:leading-relaxed [&_p]:text-muted-foreground",
              "[&_p+p]:mt-4 [&_ul+p]:mt-4",
              "[&_ul]:mt-4 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2.5",
              "[&_li]:relative [&_li]:pl-5 [&_li]:text-base [&_li]:leading-relaxed [&_li]:text-muted-foreground",
              "[&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:top-[0.7em] [&_li]:before:size-1.5 [&_li]:before:rounded-full [&_li]:before:bg-subtle-foreground",
              "[&_strong]:font-semibold [&_strong]:text-foreground",
              "[&_a]:font-semibold [&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 hover:[&_a]:decoration-foreground",
            ].join(" ")}
          >
            {children}
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
