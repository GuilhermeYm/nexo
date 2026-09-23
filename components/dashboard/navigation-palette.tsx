"use client";

import { ArrowRight, FolderClosed, LayoutGrid, Search, X, type LucideIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { DASHBOARD_NAV_ITEMS } from "@/lib/dashboard/navigation";
import type { FolderItem } from "@/lib/folders/types";
import { cn } from "@/lib/utils";

type PaletteKind = "pages" | "workspaces";
/** O que o seletor de Alt+W lista: as workspaces ou as pastas de notas. */
type DisplayKind = "workspaces" | "folders";

interface WorkspaceChoice {
  id: string;
  name: string;
  isDefault: boolean;
}

interface NavigationChoice {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Presente quando o destino é uma pasta: o href tem query string. */
  folderId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Os dois estados do botão de troca do cabeçalho (visível só em Alt+W). */
const DISPLAY_TOGGLES: { key: DisplayKind; label: string; icon: LucideIcon }[] = [
  { key: "workspaces", label: "Workspaces", icon: LayoutGrid },
  { key: "folders", label: "Pastas", icon: FolderClosed },
];

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
  const [display, setDisplay] = useState<DisplayKind>("workspaces");
  const [query, setQuery] = useState("");
  const [workspaceState, setWorkspaceState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    items: WorkspaceChoice[];
  }>({ status: "idle", items: [] });
  const [folderState, setFolderState] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    items: FolderItem[];
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
      setDisplay("workspaces");
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
          UUID.test(item.id) &&
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

  // Pastas só buscam quando o seletor já está em Alt+W e a pessoa trocou para
  // lá: as duas listas nunca são buscadas de uma vez.
  useEffect(() => {
    if (kind !== "workspaces" || display !== "folders") return;
    const controller = new AbortController();

    async function loadFolders() {
      try {
        const response = await fetch("/api/folders", { signal: controller.signal });
        if (!response.ok) throw new Error("Falha ao carregar pastas");
        const body: unknown = await response.json();
        const raw =
          body && typeof body === "object" && "folders" in body ? body.folders : null;
        if (!Array.isArray(raw)) throw new Error("Lista inválida de pastas");

        const items = raw.filter((item): item is FolderItem =>
          item !== null &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          UUID.test(item.id) &&
          typeof item.name === "string"
        );
        if (!controller.signal.aborted) setFolderState({ status: "ready", items });
      } catch (error) {
        if (!controller.signal.aborted && (error as Error).name !== "AbortError") {
          setFolderState({ status: "error", items: [] });
        }
      }
    }

    void loadFolders();
    return () => controller.abort();
  }, [kind, display]);

  const exibindoPastas = kind === "workspaces" && display === "folders";
  const choices: NavigationChoice[] = kind === "pages"
    ? DASHBOARD_NAV_ITEMS.filter((item) => item.ready).map((item) => ({
        href: item.href,
        label: item.label,
        icon: item.icon,
      }))
    : exibindoPastas
      ? folderState.items.map((folder) => ({
          href: `/dashboard/notas?folder=${folder.id}`,
          label: folder.name,
          icon: FolderClosed,
          folderId: folder.id,
        }))
      : workspaceState.items.map((workspace) => ({
          href: `/workspace/${workspace.id}`,
          label: workspace.name,
          icon: LayoutGrid,
        }));
  const filtered = choices.filter((choice) =>
    choice.label.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"))
  );
  /** O que a lista da vez responde: loading, erro ou vazio. */
  const statusLista = kind === "pages"
    ? "ready"
    : exibindoPastas
      ? folderState.status
      : workspaceState.status;
  // A lista só existe com o seletor aberto — ou seja, sempre no cliente —,
  // então ler `location.search` na hora do render não diverge do HTML do
  // servidor, e cada abertura re-renderiza. `useSearchParams` nasceria aqui uma
  // fronteira de Suspense no layout raiz; o projeto já optou por não pagar
  // isso (mesmo motivo do comentário em app/workspace/[id]/page.tsx).
  const pastaNaUrl =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("folder");

  function close() {
    setKind(null);
  }

  function navigate(href: string) {
    close();
    if (href !== pathname) router.push(href);
  }

  function trocarExibicao(proxima: DisplayKind) {
    if (proxima === display) return;
    setDisplay(proxima);
    setQuery("");
    // A lista nova entra já em carregando: sem isso, um quadro da lista velha
    // aparece antes do efeito buscar.
    if (proxima === "folders") setFolderState({ status: "loading", items: [] });
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
          {kind === "workspaces"
            ? display === "folders"
              ? "Buscar pasta"
              : "Buscar workspace"
            : "Buscar página"}
        </label>
        <input
          ref={searchRef}
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            kind === "workspaces"
              ? display === "folders"
                ? "Ir para uma pasta…"
                : "Ir para um workspace…"
              : "Ir para uma página…"
          }
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
        <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
          <h2 id={titleId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {kind === "pages"
              ? "Páginas do dashboard"
              : display === "folders"
                ? "Pastas"
                : "Workspaces"}
          </h2>
          {kind === "workspaces" && (
            <div role="group" aria-label="Exibir" className="flex gap-0.5 rounded-lg bg-tertiary/70 p-0.5">
              {DISPLAY_TOGGLES.map((toggle) => {
                const on = display === toggle.key;
                const Icon = toggle.icon;
                return (
                  <button
                    key={toggle.key}
                    type="button"
                    aria-pressed={on}
                    title={toggle.label}
                    onClick={() => trocarExibicao(toggle.key)}
                    data-focus-ring="container"
                    className={cn(
                      "relative isolate flex size-7 items-center justify-center rounded-md transition-[color,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100 pointer-coarse:size-9",
                      on ? "text-foreground" : "text-subtle-foreground hover:text-foreground"
                    )}
                  >
                    {/* A pastilha é uma camada própria, não o fundo do botão:
                        cor de fundo não interpola bem a partir do transparente. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-0 -z-10 rounded-md bg-background shadow-sm",
                        "transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                        on ? "scale-100 opacity-100" : "scale-75 opacity-0"
                      )}
                    />
                    <Icon
                      className={cn(
                        "size-4 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                        on ? "scale-100" : "scale-90"
                      )}
                      aria-hidden="true"
                    />
                    <span className="sr-only">{toggle.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {kind !== "pages" && statusLista === "loading" && (
          <p role="status" className="px-2 py-4 text-sm text-muted-foreground">
            {exibindoPastas ? "Carregando pastas…" : "Carregando workspaces…"}
          </p>
        )}
        {kind !== "pages" && statusLista === "error" && (
          <p role="alert" className="px-2 py-4 text-sm text-error">
            {exibindoPastas
              ? "Não foi possível carregar as pastas. Feche e tente de novo."
              : "Não foi possível carregar os workspaces. Feche e tente de novo."}
          </p>
        )}
        {statusLista === "ready" && filtered.length === 0 && (
          <p role="status" className="px-2 py-4 text-sm text-muted-foreground">
            {query
              ? "Nenhum resultado para essa busca."
              : exibindoPastas
                ? "Nenhuma pasta disponível."
                : "Nenhum workspace disponível."}
          </p>
        )}
        <div className="flex flex-col gap-0.5">
          {filtered.map((choice, index) => {
            const Icon = choice.icon;
            const current =
              choice.folderId !== undefined
                ? pathname === "/dashboard/notas" && pastaNaUrl === choice.folderId
                : choice.href === pathname;
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
