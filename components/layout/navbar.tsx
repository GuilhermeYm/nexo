"use client";

import gsap from "gsap";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { label: "Funcionalidades", href: "#features" },
  { label: "Como funciona", href: "#como-funciona" },
  { label: "Planos", href: "#planos" },
  { label: "Perguntas frequentes", href: "#faq" },
];

/**
 * Barra superior.
 *
 * Abaixo de `md` as âncoras não cabem, e quem cobre esse caso é a
 * `MobileCtaBar` no rodapé da tela — aqui sobra o essencial: marca, entrar,
 * criar conta e tema.
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
          <Button asChild size="sm" variant="ghost">
            <Link href="/login">Entrar</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/registro">Criar conta</Link>
          </Button>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
