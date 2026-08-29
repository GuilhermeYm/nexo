"use client";

import { Moon, Sun } from "lucide-react";
import { useLayoutEffect } from "react";

import {
  applyTheme,
  currentTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

/**
 * O botão não guarda o tema em estado do React: o que muda entre claro e
 * escuro (ícone e rótulo acessível) é decidido em CSS, pelo atributo
 * data-theme em <html>. Assim o HTML do servidor e o do cliente são idênticos
 * — sem erro de hidratação no aria-label — e o tema certo já está aplicado
 * antes do primeiro paint, pelo script inline de app/layout.tsx.
 *
 * O nome acessível vem dos dois <span> abaixo: o que não vale para o tema
 * atual sai com `display: none` e, por isso, fica fora do cálculo do nome.
 */
export function ThemeToggle() {
  // Reaplica o atributo depois que o Strict Mode remonta a árvore em
  // desenvolvimento e o React limpa os atributos de <html> que não vêm do JSX.
  // Em produção não faz nada além de reafirmar o valor que já está lá.
  useLayoutEffect(() => {
    applyTheme(resolveTheme());
  }, []);

  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Sem persistência, a escolha vale só para esta sessão.
    }
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="flex size-9 shrink-0 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground pointer-coarse:size-11"
    >
      <Moon className="size-[18px] dark:hidden" aria-hidden="true" />
      <Sun className="hidden size-[18px] dark:block" aria-hidden="true" />
      <span className="sr-only dark:hidden">Ativar tema escuro</span>
      <span className="sr-only hidden dark:inline">Ativar tema claro</span>
    </button>
  );
}
