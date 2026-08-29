import Link from "next/link";
import type { ReactNode } from "react";

import {
  AuthShowcase,
  type AuthShowcaseVariant,
} from "@/components/layout/auth-showcase";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  variant: AuthShowcaseVariant;
  children: ReactNode;
}

// Layout compartilhado das páginas de autenticação: formulário à esquerda e
// preview do produto à direita (apenas em telas grandes).
export function AuthLayout({
  title,
  subtitle,
  variant,
  children,
}: AuthLayoutProps) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <Link
          href="/"
          className="font-display text-2xl font-bold tracking-tight text-foreground"
        >
          n<span className="text-subtle-foreground">.</span>
          <span className="sr-only">Nexo — voltar para a página inicial</span>
        </Link>

        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-sm">
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

            <div className="mt-8">{children}</div>
          </div>
        </div>
      </section>

      <aside className="hidden border-l border-border bg-secondary lg:flex lg:items-center lg:justify-center lg:p-12">
        <AuthShowcase variant={variant} />
      </aside>
    </main>
  );
}
