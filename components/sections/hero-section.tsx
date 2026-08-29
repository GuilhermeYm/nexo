"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { ArrowRight, PlayCircle } from "lucide-react";
import { useEffect, useRef } from "react";

import { HeroDemo } from "@/components/sections/hero-demo";
import { HeroVideoBackground } from "@/components/sections/hero-video-background";
import { Button } from "@/components/ui/button";

gsap.registerPlugin(ScrollTrigger);

// Só entra aqui o que é verdade hoje. "Código aberto" saiu: o PRODUCT.md marca
// a alegação como não confirmada, e o lugar dela é ocupado por um fato do
// sistema — os arquivos ficam mesmo em buckets privados (ver AGENTS.md §8).
const TRUST_POINTS = [
  "Assinatura mensal ou anual",
  "Projeto brasileiro",
  "Arquivos em buckets privados",
  "Multiplataforma",
];

export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const ctx = gsap.context(() => {
      // Estado inicial já é o final: sem JS (ou com "reduzir movimento"),
      // o conteúdo permanece visível e nada quebra.
      if (prefersReducedMotion) return;

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      // O título entra inteiro. Antes eram três <span class="block"> com
      // stagger, e as quebras fixas que a animação exigia produziam órfãos em
      // 390px. Um bloco só, equilibrado pelo navegador, quebra onde couber.
      tl.from(
        "[data-animate='heading']",
        { opacity: 0, y: 28, duration: 0.9 },
        0.2
      )
        .from(
          "[data-animate='subheading']",
          { opacity: 0, y: 20, duration: 0.7 },
          "-=0.5"
        )
        .from(
          "[data-animate='cta']",
          { opacity: 0, y: 16, scale: 0.96, duration: 0.6, stagger: 0.1 },
          "-=0.4"
        )
        .from(
          "[data-animate='trust']",
          { opacity: 0, y: 12, duration: 0.6 },
          "-=0.3"
        )
        .from(
          "[data-animate='demo-card']",
          { opacity: 0, y: 40, scale: 0.96, duration: 0.9 },
          "-=0.2"
        )
        .from(
          "[data-animate='demo-badge']",
          { opacity: 0, x: 24, duration: 0.5, stagger: 0.12 },
          "-=0.55"
        );

      // Flutuação contínua e suave para dar vida ao mockup do produto.
      gsap.to("[data-animate='demo-card']", {
        y: "+=10",
        duration: 3.4,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        delay: 1.6,
      });

      gsap.to("[data-animate='glow']", {
        scale: 1.08,
        opacity: 0.8,
        duration: 4,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        stagger: 0.6,
      });

      // Parallax: três planos em velocidades diferentes criam profundidade.
      // O vídeo é o mais lento (fundo), o texto intermediário, o mockup o
      // mais rápido — como se estivesse mais perto do observador.
      const parallax = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "bottom top",
          scrub: 0.5,
        },
      });

      parallax
        .to("[data-parallax='video']", { yPercent: 14, ease: "none" }, 0)
        .to(
          "[data-parallax='copy']",
          { yPercent: 26, opacity: 0.25, ease: "none" },
          0
        )
        .to("[data-parallax='demo']", { yPercent: -8, ease: "none" }, 0);
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative isolate overflow-hidden bg-background pt-32 pb-28 sm:pt-44 sm:pb-36"
    >
      <HeroVideoBackground />

      <div
        data-parallax="copy"
        className="mx-auto flex max-w-5xl flex-col items-center px-6 text-center"
      >
        <h1
          data-animate="heading"
          className="max-w-4xl text-[2.5rem] leading-[1.05] font-bold tracking-[-0.035em] text-balance text-foreground font-[family-name:var(--font-display)] sm:text-6xl md:text-7xl"
        >
          O segundo cérebro que você sempre quis, sem o trabalho que você sempre
          evitou.
        </h1>

        <p
          data-animate="subheading"
          className="mt-7 max-w-xl text-lg leading-relaxed text-balance text-muted-foreground sm:text-xl"
        >
          Capture em segundos. Encontre em milissegundos. A Nexo conecta o que
          você nem sabia que tinha.
        </p>

        <div className="mt-10 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
          <Button asChild size="lg" data-animate="cta">
            <Link href="/registro">
              Começar gratuitamente
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" data-animate="cta">
            <Link href="#como-funciona">
              <PlayCircle className="size-4" />
              Ver como funciona
            </Link>
          </Button>
        </div>

        <ul
          data-animate="trust"
          className="mt-12 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-sm text-muted-foreground"
        >
          {TRUST_POINTS.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-1 rounded-full bg-subtle-foreground"
              />
              {point}
            </li>
          ))}
        </ul>
      </div>

      <div
        data-parallax="demo"
        className="mx-auto mt-20 max-w-6xl px-6 sm:mt-24"
      >
        <HeroDemo />
      </div>
    </section>
  );
}
