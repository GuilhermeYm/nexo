"use client";

import { cn } from "@/lib/utils";

interface LoadingScreenProps {
  /** Mensagem exibida abaixo do logo. */
  message?: string;
  className?: string;
}

/**
 * Tela de carregamento padrão da Nexo.
 *
 * Usada pelos arquivos `loading.tsx` do App Router para dar feedback
 * imediato enquanto Server Components buscam dados ou enquanto o cliente
 * navega para uma nova rota. Mantém a identidade visual (logo "n.") e uma
 * mensagem clara, com animações suaves que não competem com o conteúdo.
 */
export function LoadingScreen({
  message = "Carregando sua Nexo…",
  className,
}: LoadingScreenProps) {
  return (
    <div
      className={cn(
        "flex h-dvh w-full flex-col items-center justify-center bg-secondary",
        className
      )}
    >
      <div className="flex flex-col items-center gap-5">
        {/* Logo com anel rotativo ao redor. */}
        <div className="relative flex size-[88px] items-center justify-center">
          <div className="absolute inset-0 animate-loading-ring motion-reduce:animate-none">
            <div className="size-full rounded-full border-2 border-dashed border-border" />
          </div>
          <span className="relative flex size-14 items-center justify-center rounded-2xl bg-accent text-2xl font-bold text-accent-foreground font-[family-name:var(--font-display)] animate-loading-pulse motion-reduce:animate-none">
            n.
          </span>
        </div>

        {/* Três bolinhas que pulam em sequência. */}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-1.5 rounded-full bg-muted-foreground animate-loading-dots motion-reduce:animate-none"
              style={{ animationDelay: `${index * 140}ms` }}
            />
          ))}
        </div>

        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
