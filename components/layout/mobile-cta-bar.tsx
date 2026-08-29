"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Barra de ação fixa — só abaixo de `lg`.
 *
 * Abaixo desse ponto a navbar não tem espaço para as âncoras, e a página tem
 * uns 10.000px: quem rolou até o meio ficava sem nenhuma saída além de rolar
 * de volta. Em vez de um menu hambúrguer (que resolve navegação e não resolve
 * conversão), a barra carrega as duas coisas que importam numa superfície de
 * persuasão: o preço e o botão.
 *
 * Ela aparece só depois do hero — enquanto o CTA original está na tela, um
 * segundo CTA fixo seria repetição ocupando 15% de um aparelho de 390px.
 */
export function MobileCtaBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 640);
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 backdrop-blur-xl transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none lg:hidden",
        visible ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
      )}
      // Fora da tela ele também sai da ordem de foco, para o Tab não parar
      // num botão que ninguém está vendo.
      inert={!visible}
    >
      <div className="flex items-center gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Link
          href="#planos"
          className="shrink-0 px-2 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Planos
        </Link>
        <Button asChild className="flex-1">
          <Link href="/registro">Começar gratuitamente</Link>
        </Button>
      </div>
    </div>
  );
}
