"use client";

import {
  ExternalLink,
  FileText,
  FolderClosed,
  LayoutGrid,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { SidebarFolders } from "@/components/dashboard/sidebar-folders";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { WorkspaceSummary } from "@/lib/dashboard/queries";
import {
  DASHBOARD_NAV_ITEMS,
  type DashboardNavItem,
} from "@/lib/dashboard/navigation";
import {
  PREFERENCES_EVENT,
  readSidebarView,
  writeSidebarView,
  type SidebarView,
} from "@/lib/preferences";
import { cn } from "@/lib/utils";

/**
 * O seletor do que a barra lista.
 *
 * São dois interruptores, não três opções: "Ambos" não tem ícone que se
 * adivinhe, mas os dois ligados ao mesmo tempo dizem a mesma coisa sem
 * precisar de nome. Cada um liga e desliga a sua lista; o último aceso não
 * apaga, senão a barra ficaria vazia sem que ninguém tivesse pedido isso.
 */
const VIEW_TOGGLES: {
  key: "workspaces" | "folders";
  label: string;
  icon: LucideIcon;
  /** Para onde a escolha vai quando este interruptor apaga. */
  off: SidebarView;
}[] = [
  { key: "workspaces", label: "Workspaces", icon: LayoutGrid, off: "folders" },
  { key: "folders", label: "Pastas", icon: FolderClosed, off: "workspaces" },
];

function subscribePreferences(onChange: () => void) {
  window.addEventListener(PREFERENCES_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PREFERENCES_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Os seis matizes de tag do tema, endereçados pela posição gravada no banco. */
const WORKSPACE_DOT: Record<string, string> = {
  "1": "bg-tag-1-foreground",
  "2": "bg-tag-2-foreground",
  "3": "bg-tag-3-foreground",
  "4": "bg-tag-4-foreground",
  "5": "bg-tag-5-foreground",
  "6": "bg-tag-6-foreground",
};

interface SidebarProps {
  /** Trilho expandido ou recolhido. Só vale a partir de `md`. */
  open: boolean;
  /** Gaveta aberta. Só vale abaixo de `md`, onde o trilho vira sobreposição. */
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  onCreateWorkspace: () => void;
  /** Quem faz a chamada é o shell, que também guarda a lista. */
  onDeleteWorkspace: (workspace: WorkspaceSummary) => void;
  /**
   * Avisa que este workspace passa a estar aberto.
   *
   * O trilho é a lista completa; a barra de cima é o que a pessoa deixou à
   * mão. Abrir daqui põe o workspace lá — é o caminho de volta para quem
   * fechou uma aba, e sem ele fechar seria uma porta de mão única.
   */
  onOpenWorkspace: (workspaceId: string) => void;
  /** Quem persiste é o shell — ele guarda a lista e mostra os avisos. */
  onRenameWorkspace: (workspace: WorkspaceSummary, name: string) => void;
  userName: string | null;
  userEmail: string;
  /** Notificações não lidas para o badge da Entrada. */
  unreadCount?: number;
}

/**
 * Trilho lateral do dashboard.
 *
 * Colapsado é um trilho de ícones; aberto, a navegação com rótulo e a lista
 * de workspaces. A largura é a única coisa que anima — os rótulos aparecem
 * por opacidade dentro de uma faixa de largura fixa, então nada reflui
 * durante a transição e o texto não estica.
 *
 * O trilho é sempre montado: colapsar não desmonta nada, o que mantém o foco
 * do teclado onde estava e evita o salto de layout de um `display: none`.
 */
export function Sidebar({
  open,
  drawerOpen,
  onCloseDrawer,
  workspaces,
  activeWorkspaceId,
  onCreateWorkspace,
  onDeleteWorkspace,
  onOpenWorkspace,
  onRenameWorkspace,
  userName,
  userEmail,
  unreadCount,
}: SidebarProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  // A escolha mora no navegador (por aparelho, como as abas). No servidor e
  // na hidratação vale o padrão; o valor guardado entra logo depois. Sem
  // localStorage, `picked` segura a escolha durante a sessão.
  const storedView = useSyncExternalStore(
    subscribePreferences,
    readSidebarView,
    () => "workspaces" as const
  );
  const [picked, setPicked] = useState<SidebarView | null>(null);
  const view = picked ?? storedView;
  const showWorkspaces = view !== "folders";
  const showFolders = view !== "workspaces";

  function chooseView(next: SidebarView) {
    setPicked(next);
    writeSidebarView(next);
  }

  // Na gaveta os rótulos sempre aparecem: ela é larga por definição, e um
  // trilho de ícones sobreposto seria o pior dos dois formatos.
  const labelsVisible = drawerOpen || open;

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <>
      {/* Fundo da gaveta. Só existe abaixo de `md`, e some junto com ela —
          sem ele, tocar fora não fecharia nada e a gaveta viraria uma
          armadilha em tela pequena. */}
      <div
        onClick={onCloseDrawer}
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] md:hidden",
          "transition-opacity duration-200 ease-out motion-reduce:transition-none",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      <aside
        data-open={open}
        aria-label="Navegação principal"
        className={cn(
          "group/side flex flex-col border-r border-border bg-secondary",
          "transition-[width,transform] duration-200 ease-out motion-reduce:transition-none",
          // Abaixo de `md` o trilho é uma gaveta sobreposta: numa tela de
          // 390px, 68px de trilho fixo seriam um quinto da largura gasto em
          // ícones que o usuário não está usando agora.
          "fixed inset-y-0 left-0 z-40 w-[248px]",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
          // De `md` para cima ele volta a ser coluna do layout.
          "md:relative md:z-30 md:translate-x-0 md:shrink-0",
          open ? "md:w-[248px]" : "md:w-[68px]"
        )}
      >
        {/* Marca */}
        <div className="flex h-14 items-center gap-3 px-[18px]">
          <Link
            href="/dashboard"
            className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent text-sm font-bold text-accent-foreground font-[family-name:var(--font-display)]"
          >
            n.
          </Link>
          <SideLabel open={labelsVisible}>
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              Nexo
            </span>
          </SideLabel>
        </div>

        {/* Navegação */}
        <nav className="mt-2 px-3">
          <ul className="flex flex-col gap-0.5">
            {DASHBOARD_NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <NavRow
                  item={item}
                  open={labelsVisible}
                  badge={
                    item.label === "Entrada" && unreadCount ? unreadCount : undefined
                  }
                />
              </li>
            ))}
          </ul>
        </nav>

        {/* O que a barra lista: workspaces (lousas), pastas (notas), ou os
            dois. Recolhido, o seletor some — o trilho mostra o que foi
            escolhido, em ícones. */}
        <div className="mt-6 flex min-h-0 flex-1 flex-col px-3">
          {labelsVisible && (
            <div
              role="group"
              aria-label="Mostrar na barra lateral"
              className="mb-3 flex gap-0.5 self-end rounded-lg bg-tertiary/70 p-0.5"
            >
              {VIEW_TOGGLES.map((toggle) => {
                const on = view !== toggle.off;
                const Icon = toggle.icon;
                return (
                  <button
                    key={toggle.key}
                    type="button"
                    aria-pressed={on}
                    title={toggle.label}
                    onClick={() => chooseView(on ? toggle.off : "both")}
                    className={cn(
                      "relative isolate flex size-7 items-center justify-center rounded-md transition-[color,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100 pointer-coarse:size-9",
                      on ? "text-foreground" : "text-subtle-foreground hover:text-foreground"
                    )}
                  >
                    {/* A pastilha é uma camada própria, não o fundo do botão:
                        cor de fundo não interpola bem a partir do transparente,
                        e uma camada dá para crescer e sumir de verdade. */}
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

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain">
            {showWorkspaces && (
              <section aria-label="Workspaces">
                <div
                  className={cn(
                    "flex h-6 items-center",
                    labelsVisible ? "justify-between pr-1 pl-[9px]" : "justify-center"
                  )}
                >
                  {labelsVisible && (
                    <SideLabel open>
                      <span className="text-[11px] font-semibold tracking-wide text-subtle-foreground uppercase">
                        Workspaces
                      </span>
                    </SideLabel>
                  )}
                  <button
                    type="button"
                    onClick={onCreateWorkspace}
                    title="Novo workspace"
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    <span className="sr-only">Novo workspace</span>
                  </button>
                </div>

                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {workspaces.map((workspace) => (
                    <WorkspaceRow
                      key={workspace.id}
                      workspace={workspace}
                      isActive={workspace.id === activeWorkspaceId}
                      labelsVisible={labelsVisible}
                      // Zero workspaces é um estado sem tela: a rota recusa, e a
                      // interface diz isso antes de a pessoa tentar.
                      canDelete={workspaces.length > 1}
                      onCloseDrawer={onCloseDrawer}
                      onOpen={() => onOpenWorkspace(workspace.id)}
                      onRename={(name) => onRenameWorkspace(workspace, name)}
                      onDelete={() => onDeleteWorkspace(workspace)}
                    />
                  ))}
                </ul>
              </section>
            )}

            {showFolders && (
              <section aria-label="Pastas de notas">
                <div
                  className={cn(
                    "flex h-6 items-center",
                    labelsVisible ? "justify-between pr-1 pl-[9px]" : "justify-center"
                  )}
                >
                  {labelsVisible && (
                    <SideLabel open>
                      <span className="text-[11px] font-semibold tracking-wide text-subtle-foreground uppercase">
                        Pastas
                      </span>
                    </SideLabel>
                  )}
                  <Link
                    href="/dashboard/notas"
                    onClick={onCloseDrawer}
                    title="Todas as notas"
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
                  >
                    <FileText className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">Todas as notas</span>
                  </Link>
                </div>
                <div className="mt-1.5">
                  <SidebarFolders
                    labelsVisible={labelsVisible}
                    onCloseDrawer={onCloseDrawer}
                    workspaces={workspaces}
                  />
                </div>
              </section>
            )}
          </div>
        </div>

        {/* Rodapé: conta */}
        <div className="mt-2 border-t border-border p-3">
          <div className="flex items-center gap-3 px-[5px] py-1.5">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-tertiary text-xs font-semibold text-foreground"
            >
              {(userName ?? userEmail).charAt(0).toUpperCase()}
            </span>
            <SideLabel open={labelsVisible} className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">
                {userName ?? "Sua conta"}
              </span>
              <span className="block truncate text-xs text-subtle-foreground">
                {userEmail}
              </span>
            </SideLabel>
          </div>

          <div
            className={cn(
              "mt-1 flex items-center gap-0.5",
              labelsVisible ? "flex-row" : "flex-col"
            )}
          >
            <Link
              href="/dashboard/configuracoes"
              title="Configurações"
              className="flex size-8 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
            >
              <Settings className="size-4" aria-hidden="true" />
              <span className="sr-only">Configurações</span>
            </Link>
            <ThemeToggle />
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              title="Sair"
              className="flex size-8 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span className="sr-only">Sair</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * Faixa de rótulo do trilho.
 *
 * A largura vai a zero junto com o colapso, mas o conteúdo mantém a largura
 * natural por dentro (`w-[178px]` fixo): assim o texto não é reflowado
 * durante a animação — ele desliza para fora do recorte, inteiro.
 */
function SideLabel({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden={!open}
      className={cn(
        "overflow-hidden whitespace-nowrap transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        open
          ? "translate-x-0 opacity-100"
          : "pointer-events-none -translate-x-1 opacity-0",
        className
      )}
    >
      {children}
    </span>
  );
}

function NavRow({
  item,
  open,
  badge,
}: {
  item: DashboardNavItem;
  open: boolean;
  badge?: number;
}) {
  const Icon = item.icon;
  const isReady = item.ready ?? false;

  const shared = cn(
    "flex h-9 items-center rounded-lg transition-colors duration-150",
    open ? "gap-3 px-[9px]" : "justify-center px-0",
    isReady
      ? "text-foreground hover:bg-tertiary"
      : "cursor-not-allowed text-subtle-foreground"
  );

  const count = isReady && badge !== undefined && badge > 0 ? badge : 0;

  const body = (
    <>
      {/* O número fica sobre o ícone, não no fim do rótulo: recolhido, o
          trilho só tem o ícone, e é justamente aí que ele mais precisa
          dizer que há algo novo. */}
      <span className="relative flex shrink-0">
        <Icon className="size-[18px]" aria-hidden="true" />
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold tabular-nums text-accent-foreground ring-2 ring-secondary"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </span>
      <SideLabel open={open} className={open ? "flex-1" : "w-0 flex-none"}>
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm">{item.label}</span>
          {!isReady && (
            <span className="text-[11px] text-subtle-foreground">em breve</span>
          )}
        </span>
      </SideLabel>
      {count > 0 && (
        <span className="sr-only">
          {count === 1 ? "1 não lida" : `${count} não lidas`}
        </span>
      )}
    </>
  );

  if (!isReady) {
    return (
      <span
        aria-disabled="true"
        title={!open ? `${item.label} — em breve` : undefined}
        className={shared}
      >
        {body}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      title={
        !open
          ? count > 0
            ? `${item.label} — ${count === 1 ? "1 não lida" : `${count} não lidas`}`
            : item.label
          : undefined
      }
      className={shared}
    >
      {body}
    </Link>
  );
}

/**
 * Uma linha de workspace no trilho.
 *
 * O botão direito abre o menu — e o toque longo também, porque o gatilho do
 * Radix trata os dois. O botão "⋯" existe além deles por descoberta: quem
 * nunca tentou o botão direito numa lista precisa ver que há algo ali. Ele
 * dispara o mesmo evento de menu de contexto na própria linha, então existe
 * um só menu, num só lugar do código.
 *
 * A exclusão não vira um "x" visível na linha: um botão de apagar a um
 * clique de distância de um item que a pessoa usa dezenas de vezes por dia é
 * acidente esperando acontecer.
 */
function WorkspaceRow({
  workspace,
  isActive,
  labelsVisible,
  canDelete,
  onCloseDrawer,
  onOpen,
  onRename,
  onDelete,
}: {
  workspace: WorkspaceSummary;
  isActive: boolean;
  labelsVisible: boolean;
  canDelete: boolean;
  onCloseDrawer: () => void;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const rowRef = useRef<HTMLLIElement>(null);
  const [renaming, setRenaming] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) return;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [renaming]);

  function commitRename(raw: string) {
    setRenaming(false);
    const next = raw.trim();
    if (next && next !== workspace.name) onRename(next);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li ref={rowRef} className="group/ws relative">
          {/* O campo de renomear flutua por cima da linha, com largura
              própria: no trilho recolhido a coluna tem 68px, e um campo
              espremido nesse espaço seria um recurso que só existe para
              quem está com o trilho aberto. */}
          {renaming && (
            <div className="absolute inset-y-0 left-0 z-20 flex h-9 w-[220px] items-center gap-2 rounded-lg border border-border bg-background px-2">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  WORKSPACE_DOT[workspace.color ?? ""] ?? "bg-subtle-foreground"
                )}
              />
              <input
                ref={nameRef}
                defaultValue={workspace.name}
                onBlur={(event) => commitRename(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setRenaming(false);
                }}
                maxLength={60}
                aria-label={`Novo nome de ${workspace.name}`}
                className="h-7 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              />
            </div>
          )}

          <Link
            href={`/workspace/${workspace.id}`}
            onClick={() => {
              onCloseDrawer();
              onOpen();
            }}
            aria-current={isActive ? "page" : undefined}
            title={!labelsVisible ? workspace.name : undefined}
            className={cn(
              "flex h-9 w-full items-center rounded-lg text-left transition-colors duration-150",
              labelsVisible ? "gap-3 px-[9px]" : "justify-center px-0",
              isActive
                ? "bg-tertiary text-foreground"
                : "text-muted-foreground hover:bg-tertiary/60 hover:text-foreground"
            )}
          >
            <span
              className={cn(
                "size-2 shrink-0 rounded-full transition-colors duration-150",
                WORKSPACE_DOT[workspace.color ?? ""] ??
                  (isActive ? "bg-foreground" : "bg-subtle-foreground")
              )}
            />
            <SideLabel
              open={labelsVisible}
              className={labelsVisible ? "flex-1" : "w-0 flex-none"}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm">{workspace.name}</span>
                {/* A contagem cede o lugar ao botão de opções quando o
                    ponteiro chega: as duas coisas moram no mesmo canto, e só
                    uma delas interessa por vez. */}
                <span
                  title={`${workspace.noteCount} nota${workspace.noteCount === 1 ? "" : "s"}`}
                  className="shrink-0 text-xs tabular-nums text-subtle-foreground transition-opacity duration-150 group-hover/ws:opacity-0 group-focus-within/ws:opacity-0"
                >
                  {workspace.noteCount}
                </span>
              </span>
            </SideLabel>
          </Link>

          {labelsVisible && (
            <button
              type="button"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                rowRef.current?.dispatchEvent(
                  new MouseEvent("contextmenu", {
                    bubbles: true,
                    clientX: box.left,
                    clientY: box.bottom,
                  })
                );
              }}
              aria-label={`Opções de ${workspace.name}`}
              className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-subtle-foreground opacity-0 transition-opacity duration-150 hover:bg-background hover:text-foreground group-hover/ws:opacity-100 focus-visible:opacity-100"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          )}
        </li>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => {
            onCloseDrawer();
            onOpen();
            router.push(`/workspace/${workspace.id}`);
          }}
        >
          <ExternalLink className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
          <ContextMenuItemLabel label="Abrir a lousa" />
        </ContextMenuItem>

        <ContextMenuItem onSelect={() => setRenaming(true)}>
          <Pencil className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
          <ContextMenuItemLabel label="Renomear" />
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          destructive
          disabled={!canDelete}
          confirmLabel="Excluir para valer"
          onSelect={onDelete}
        >
          <Trash2 className="mt-0.5 size-4 shrink-0" />
          <ContextMenuItemLabel
            label="Excluir workspace"
            // O número sai do próprio resumo: a pessoa decide sabendo o
            // tamanho do que está mexendo, e sabendo que o conteúdo fica.
            hint={
              !canDelete
                ? "Você precisa de pelo menos um workspace."
                : workspace.noteCount === 0
                  ? "Não há notas aqui. Só o arranjo da lousa se perde."
                  : `${workspace.noteCount} nota${workspace.noteCount > 1 ? "s continuam" : " continua"} na sua conta. Só o arranjo da lousa se perde.`
            }
          />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
