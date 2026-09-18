import Link from "next/link";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { NEXO_GITHUB_URL } from "@/lib/site";

interface FooterColumn {
  title: string;
  links: { label: string; href: string; external?: boolean }[];
}

const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Produto",
    links: [
      { label: "Funcionalidades", href: "#features" },
      { label: "Como funciona", href: "#como-funciona" },
      { label: "Instalar", href: "#instalar" },
      { label: "Perguntas frequentes", href: "#faq" },
    ],
  },
  {
    title: "Código",
    links: [
      { label: "Repositório no GitHub", href: NEXO_GITHUB_URL, external: true },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Termos de uso", href: "/termos" },
      { label: "Privacidade", href: "/privacidade" },
      { label: "Contato", href: "mailto:contato@nexo.app" },
    ],
  },
];

/**
 * Rodapé — fecha a página com o último CTA e a navegação de serviço.
 *
 * A faixa de cima repete a oferta para quem rolou tudo e ainda não clicou; a
 * de baixo é a parte burocrática, em tipo menor, porque ninguém chega aqui
 * procurando por ela.
 *
 * A coluna "Conta" (Entrar/Criar conta) saiu: não existe mais uma instância
 * central para se cadastrar. `/login` e `/registro` seguem no código, para
 * quem sobe a própria instância — só não são mais anunciados na landing.
 * O ícone de GitHub também não volta como ícone: sem um brand-icon
 * instalado, o link de texto na coluna "Código" é a versão honesta.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border/60 bg-background">
      {/* O respiro extra embaixo é o espaço da barra fixa de ação, que existe
          abaixo de `lg` — sem ele, a última linha do rodapé fica coberta. */}
      <div className="mx-auto max-w-6xl px-6 pt-16 pb-28 sm:pt-20 lg:pb-20">
        <div className="flex flex-col gap-12 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <Link href="/" className="flex w-fit items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-accent text-lg font-bold text-accent-foreground font-[family-name:var(--font-display)]">
                n.
              </span>
              <span className="text-xl font-bold font-[family-name:var(--font-display)]">
                Nexo
              </span>
            </Link>

            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
              O organizador pessoal que arruma sozinho. Você captura do jeito
              que vier; a Nexo lê, classifica e marca para você reencontrar.
            </p>

            <Button asChild className="mt-7">
              <a
                href={NEXO_GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Ver no GitHub
              </a>
            </Button>
          </div>

          <nav
            aria-label="Rodapé"
            className="grid grid-cols-2 gap-x-10 gap-y-10 sm:grid-cols-3 md:gap-x-16"
          >
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title}>
                <h3 className="text-xs font-bold tracking-wide text-foreground uppercase">
                  {column.title}
                </h3>
                <ul className="mt-3 flex flex-col gap-1">
                  {column.links.map((link) =>
                    link.external ? (
                      <li key={link.href}>
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground pointer-coarse:py-2.5"
                        >
                          {link.label}
                        </a>
                      </li>
                    ) : (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="inline-block py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground pointer-coarse:py-2.5"
                        >
                          {link.label}
                        </Link>
                      </li>
                    )
                  )}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-14 flex items-center justify-between gap-4 border-t border-border/60 pt-8">
          <p className="text-xs text-subtle-foreground">
            © {year} Nexo. Feito no Brasil.
          </p>

          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
