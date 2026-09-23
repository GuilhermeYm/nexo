"use client";

import { ArrowRight, LayoutGrid, Search, X, type LucideIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { DASHBOARD_NAV_ITEMS } from "@/lib/dashboard/navigation";

type PaletteKind = "pages" | "workspaces";

interface WorkspaceChoice {
  id: string;
  name: string;
  isDefault: boolean;
}

interface NavigationChoice {
  href: string;
  label: string;
  icon: LucideIcon;
}

const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    (target instanceof HTMLElement && target.isContentEditable) ||
    target.closest("input, textarea, select, [contenteditable], [role='textbox']") !== null
  );
}

function isAppRoute(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname.startsWith("/workspace/") ||
    pathname.startsWith("/nota/")
  );
}

/** Seletores globais de destinos, sem capturar teclas durante a edição. */
export function NavigationPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const titleId = useId();
  const searchId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [kind, setKind] = useState<PaletteKind | null>(null);
  const [query, setQuery] = useState("");
  const [workspaceState, setWorkspaceState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    items: WorkspaceChoice[];
  }>({ status: "idle", items: [] });

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (
        !isAppRoute(pathname) ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.code !== "KeyN" && event.code !== "KeyW") ||
        isEditable(event.target) ||
        isEditable(document.activeElement) ||
        document.querySelector("dialog[open], [role='menu']")
      ) {
        return;
      }

      event.preventDefault();
      setQuery("");
      if (event.code === "KeyW") {
        setWorkspaceState({ status: "loading", items: [] });
        setKind("workspaces");
      } else {
        setKind("pages");
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [pathname]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (kind && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    if (!kind && dialog.open) dialog.close();
  }, [kind]);

  useEffect(() => {
    if (kind !== "workspaces") return;
    const controller = new AbortController();

    async function loadWorkspaces() {
      try {
        const response = await fetch("/api/workspaces", { signal: controller.signal });
        if (!response.ok) throw new Error("Falha ao carregar workspaces");
        const body: unknown = await response.json();
        const raw =
          body && typeof body === "object" && "workspaces" in body
            ? body.workspaces
            : null;
        if (!Array.isArray(raw)) throw new Error("Lista inválida de workspaces");

        const items = raw.filter((item): item is WorkspaceChoice =>
          item !== null &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          WORKSPACE_ID.test(item.id) &&
          typeof item.name === "string" &&
          typeof item.isDefault === "boolean"
        );
        if (!controller.signal.aborted) setWorkspaceState({ status: "ready", items });
      } catch (error) {
        if (!controller.signal.aborted && (error as Error).name !== "AbortError") {
          setWorkspaceState({ status: "error", items: [] });
        }
      }
    }

    void loadWorkspaces();
    return () => controller.abort();
  }, [kind]);

  const choices: NavigationChoice[] = kind === "pages"
    ? DASHBOARD_NAV_ITEMS.filter((item) => item.ready).map((item) => ({
        href: item.href,
        label: item.label,
        icon: item.icon,
      }))
    : workspaceState.items.map((workspace) => ({
        href: `/workspace/${workspace.id}`,
        label: workspace.name,
        icon: LayoutGrid,
      }));
  const filtered = choices.filter((choice) =>
    choice.label.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"))
  );

  function close() {
    setKind(null);
  }

  function navigate(href: string) {
    close();
    if (href !== pathname) router.push(href);
  }

  function handleKeys(event: React.KeyboardEvent<HTMLDialogElement>) {
    // O Chrome consome a primeira Esc dentro de `input[type=search]` com texto
    // para limpar o campo — e o rodapé promete "Esc fechar". Interceptamos aqui:
    // cancelamos a limpeza nativa e fechamos direto.
    if (
      event.key === "Escape" &&
      event.target === searchRef.current &&
      searchRef.current &&
      searchRef.current.value.length > 0
    ) {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (filtered.length === 0) return;
      event.preventDefault();
      const index = optionRefs.current.findIndex((button) => button === document.activeElement);
      const next = event.key === "ArrowDown"
        ? (index + 1) % filtered.length
        : index < 0 ? filtered.length - 1 : (index - 1 + filtered.length) % filtered.length;
      optionRefs.current[next]?.focus();
      return;
    }

    if (event.key === "Enter" && event.target === searchRef.current && filtered[0]) {
      event.preventDefault();
      navigate(filtered[0].href);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onKeyDown={handleKeys}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => {
        if (kind) close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-hidden rounded-2xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/45"
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3.5 focus-within:ring-2 focus-within:ring-inset focus-within:ring-accent/40">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <label htmlFor={searchId} className="sr-only">
          {kind === "workspaces" ? "Buscar workspace" : "Buscar página"}
        </label>
        <input
          ref={searchRef}
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={kind === "workspaces" ? "Ir para um workspace…" : "Ir para uma página…"}
          data-focus-ring="container"
          className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        <button
          type="button"
          onClick={close}
          aria-label="Fechar seletor"
          data-focus-ring="container"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="max-h-[min(55dvh,24rem)] overflow-y-auto p-2">
        <h2 id={titleId} className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {kind === "workspaces" ? "Workspaces" : "Páginas do dashboard"}
        </h2>
        {kind === "workspaces" && workspaceState.status === "loading" && (
          <p role="status" className="px-2 py-4 text-sm text-muted-foreground">Carregando workspaces…</p>
        )}
        {kind === "workspaces" && workspaceState.status === "error" && (
          <p role="alert" className="px-2 py-4 text-sm text-error">Não foi possível carregar os workspaces. Feche e tente de novo.</p>
        )}
        {(kind === "pages" || workspaceState.status === "ready") && filtered.length === 0 && (
          <p role="status" className="px-2 py-4 text-sm text-muted-foreground">
            {query ? "Nenhum resultado para essa busca." : "Nenhum workspace disponível."}
          </p>
        )}
        <div className="flex flex-col gap-0.5">
          {filtered.map((choice, index) => {
            const Icon = choice.icon;
            const current = choice.href === pathname;
            return (
              <button
                key={choice.href}
                ref={(button) => { optionRefs.current[index] = button; }}
                type="button"
                onClick={() => navigate(choice.href)}
                aria-current={current ? "page" : undefined}
                data-focus-ring="container"
                className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                {current ? (
                  <span className="text-xs text-muted-foreground">Atual</span>
                ) : (
                  <ArrowRight className="size-3.5 text-muted-foreground/70" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        ↑↓ navegar · Enter abrir · Esc fechar
      </p>
    </dialog>
  );
}
