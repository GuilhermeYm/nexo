"use client";

import gsap from "gsap";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { NEXO_GITHUB_URL } from "@/lib/site";

const NAV_LINKS = [
  { label: "Funcionalidades", href: "#features" },
  { label: "Como funciona", href: "#como-funciona" },
  { label: "Instalar", href: "#instalar" },
  { label: "Perguntas frequentes", href: "#faq" },
];

/**
 * Barra superior.
 *
 * Abaixo de `md` as âncoras não cabem, e quem cobre esse caso é a
 * `MobileCtaBar` no rodapé da tela — aqui sobra o essencial: marca, o link
 * para o GitHub e o tema.
 *
 * Não existe mais "Entrar" nem "Criar conta" aqui: não há uma instância
 * central da Nexo para se cadastrar. `/login` e `/registro` continuam
 * existindo no código, para quem sobe a própria instância — só não são mais
 * anunciados na landing pública.
 */
export function Navbar() {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReducedMotion || !navRef.current) return;

    const tween = gsap.fromTo(
      navRef.current,
      { y: -24, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.7, ease: "power3.out", delay: 0.1 }
    );

    return () => {
      tween.kill();
    };
  }, []);

  return (
    <header className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <nav
        ref={navRef}
        className="flex w-full max-w-5xl items-center justify-between gap-6 rounded-3xl border border-border/60 bg-secondary/70 px-3 py-2 shadow-lg shadow-black/[0.04] backdrop-blur-xl sm:px-4 sm:py-2.5"
      >
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-2xl bg-background text-lg font-bold text-foreground font-[family-name:var(--font-display)] sm:size-10">
            n.
          </span>
          <span className="text-xl font-bold font-[family-name:var(--font-display)]">
            Nexo
          </span>
        </Link>

        <ul className="hidden items-center gap-7 text-sm text-muted-foreground lg:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex shrink-0 items-center gap-1">
          <Button asChild size="sm">
            <a href={NEXO_GITHUB_URL} target="_blank" rel="noopener noreferrer">
              Ver no GitHub
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </Button>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
