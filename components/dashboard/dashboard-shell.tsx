"use client";

import { House, PanelLeft, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CommandBar } from "@/components/dashboard/command-bar";
import { DraftNote } from "@/components/dashboard/draft-note";
import { RecentPanel } from "@/components/dashboard/recent-panel";
import { Sidebar } from "@/components/dashboard/sidebar";
import { TasksPanel } from "@/components/dashboard/tasks-panel";
import { UpgradeLink } from "@/components/ui/upgrade-link";
import { HOME_TAB, useOpenTabs } from "@/hooks/use-open-tabs";
import { usePersistedFlag } from "@/hooks/use-persisted-flag";
import { firstName, greetingFor } from "@/lib/dashboard/format";
import { readApiFailure } from "@/lib/plan-limit";
import type {
  AiJobItem,
  RecentNote,
  WorkspaceSummary,
} from "@/lib/dashboard/queries";
import { cn } from "@/lib/utils";

interface DashboardShellProps {
  userName: string | null;
  userEmail: string;
  workspaces: WorkspaceSummary[];
  jobs: AiJobItem[];
  notes: RecentNote[];
  /** Instante em que o servidor pintou a página. O primeiro render do cliente
   *  usa este mesmo valor, para o HTML bater; depois o relógio assume. */
  renderedAt: number;
  /** Hora local do servidor, só para a saudação do primeiro paint. */
  serverHour: number;
  /** Notificações não lidas para o badge da Entrada no trilho. */
  unreadCount: number;
}

const SIDEBAR_STORAGE_KEY = "nexo-sidebar-open";

export function DashboardShell({
  userName,
  userEmail,
  workspaces: initialWorkspaces,
  jobs,
  notes,
  renderedAt,
  serverHour,
  unreadCount,
}: DashboardShellProps) {
  // A preferência do trilho é local do dispositivo, não da conta: o mesmo
  // usuário quer o trilho aberto no monitor e recolhido no laptop.
  const [sidebarOpen, setSidebarOpen] = usePersistedFlag(
    SIDEBAR_STORAGE_KEY,
    true
  );
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);

  // Quais lugares estão à mão na barra de cima. É escolha deste dispositivo,
  // não da conta — ver o comentário do próprio hook.
  const { tabs, openTab, closeTab } = useOpenTabs(workspaces);

  // Relógio. Começa no instante do servidor para o primeiro render bater com
  // o HTML; só depois de montado passa a marcar o tempo de verdade.
  const [now, setNow] = useState(renderedAt);
  const [hour, setHour] = useState(serverHour);

  useEffect(() => {
    function tick() {
      const current = new Date();
      setNow(current.getTime());
      setHour(current.getHours());
    }

    tick();
    // Meio minuto é a menor granularidade que os rótulos usam ("há 4 min").
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  // Abaixo de `md` o trilho é uma gaveta sobreposta, e ela começa fechada nos
  // dois lados — servidor e cliente — para o HTML bater. Quem decide qual dos
  // dois estados o botão mexe é a largura da tela no momento do clique, já
  // depois da hidratação.
  const [drawerOpen, setDrawerOpen] = useState(false);

  function toggleSidebar() {
    if (!window.matchMedia("(min-width: 768px)").matches) {
      setDrawerOpen((current) => !current);
      return;
    }

    setSidebarOpen(!sidebarOpen);
  }

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Escapar fecha a gaveta: ela é uma sobreposição, e toda sobreposição
  // precisa de uma saída pelo teclado.
  useEffect(() => {
    if (!drawerOpen) return;

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [drawerOpen]);

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const draftRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) draftRef.current?.focus();
  }, [creating]);

  const startCreating = useCallback(() => {
    setDraftName("");
    setCreateError(null);
    setCreating(true);
  }, []);

  async function commitCreate() {
    const name = draftName.trim();
    if (!name) {
      setCreating(false);
      return;
    }

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const failure = await readApiFailure(
          response,
          response.status === 429
            ? "Muitos workspaces criados agora há pouco."
            : "Não foi possível criar."
        );

        // O teto do plano vai para o aviso de rodapé, não para a barra de
        // abas: ali cabe uma frase inteira e o caminho para os planos, e a
        // faixa das abas tem 12px de altura útil ao lado do campo. O campo de
        // nome fecha junto, porque insistir nele não vai mudar a resposta.
        if (failure.upgrade) {
          setCreating(false);
          setNotice({ message: failure.message, upgrade: true });
          return;
        }

        setCreateError(failure.message);
        return;
      }

      const { workspace } = await response.json();
      setWorkspaces((current) => [...current, workspace]);
      // Recém-criado é para onde a pessoa vai agora: entra na barra junto.
      openTab(workspace.id);
      setCreating(false);
      router.push(`/workspace/${workspace.id}`);
    } catch {
      setCreateError("Erro de conexão.");
    }
  }

  /**
   * O aviso de rodapé.
   *
   * `upgrade` muda duas coisas além do texto: o aviso ganha o caminho para os
   * planos e **para de sumir sozinho**. Um convite que desaparece em 3,6s é um
   * link que ninguém alcança — e um aviso com link precisa aceitar ponteiro,
   * o que o contêiner (`pointer-events-none`, para não cobrir a tela) não dá
   * de graça.
   */
  const [notice, setNotice] = useState<{
    message: string;
    upgrade?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!notice || notice.upgrade) return;
    const timer = setTimeout(() => setNotice(null), 3600);
    return () => clearTimeout(timer);
  }, [notice]);

  /**
   * Exclui um workspace.
   *
   * Some da lista antes da resposta chegar; se a rota recusar — só resta um
   * workspace, por exemplo — a lista volta ao que era e o aviso explica.
   */
  const handleDeleteWorkspace = useCallback(
    async (workspace: WorkspaceSummary) => {
      const previous = workspaces;
      setWorkspaces((current) =>
        current.filter((item) => item.id !== workspace.id)
      );
      // A aba iria embora sozinha na próxima leitura — o hook descarta o que
      // não existe mais —, mas ela some agora junto com a linha do trilho,
      // no mesmo quadro. Duas peças da mesma exclusão não devem sair da tela
      // em momentos diferentes.
      closeTab(workspace.id);

      try {
        const response = await fetch(`/api/workspaces/${workspace.id}`, {
          method: "DELETE",
        });
        const body = await response.json().catch(() => null);

        if (!response.ok) {
          setWorkspaces(previous);
          setNotice({
            message: body?.error ?? "Não foi possível excluir o workspace.",
          });
          return;
        }

        const kept = body?.unlinkedNotes ?? 0;
        setNotice({
          message:
            kept > 0
              ? `"${workspace.name}" foi excluído. ${kept} nota${kept > 1 ? "s continuam" : " continua"} na sua conta.`
              : `"${workspace.name}" foi excluído.`,
        });
        // As notas desvinculadas mudam a contagem dos painéis do servidor.
        router.refresh();
      } catch {
        setWorkspaces(previous);
        setNotice({ message: "Sem conexão. O workspace não foi excluído." });
      }
    },
    [workspaces, router, closeTab]
  );

  /** O rascunho virou nota de verdade: avisa e recarrega os painéis. */
  const handleDraftSaved = useCallback(
    (title: string) => {
      setNotice({ message: `"${title}" foi guardada na sua conta.` });
      router.refresh();
    },
    [router]
  );

  /**
   * Renomeia um workspace.
   *
   * O nome muda na tela antes da resposta chegar — quem renomeia está
   * olhando para o nome. Se a rota recusar, ele volta ao que era e o aviso
   * explica; o nome é o principal jeito de reencontrar as coisas, e não pode
   * ficar diferente na tela e no banco sem ninguém saber.
   */
  const handleRenameWorkspace = useCallback(
    async (workspace: WorkspaceSummary, name: string) => {
      const previous = workspaces;
      setWorkspaces((current) =>
        current.map((item) =>
          item.id === workspace.id ? { ...item, name } : item
        )
      );

      try {
        const response = await fetch(`/api/workspaces/${workspace.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setWorkspaces(previous);
          setNotice({
            message: body?.error ?? "Não foi possível renomear o workspace.",
          });
          return;
        }

        router.refresh();
      } catch {
        setWorkspaces(previous);
        setNotice({ message: "Sem conexão. O nome não mudou." });
      }
    },
    [workspaces, router]
  );

  const handleOpenNote = useCallback(
    (noteId: string) => router.push(`/nota/${noteId}`),
    [router]
  );

  const refreshTasks = useRef<(() => void) | null>(null);
  const registerRefresh = useCallback((refresh: () => void) => {
    refreshTasks.current = refresh;
  }, []);
  const handleUploaded = useCallback(() => refreshTasks.current?.(), []);

  // Os painéis lá embaixo conseguem disparar as duas ações da barra de cima:
  // "Escrever uma nota" abre o rascunho, "Enviar um arquivo" abre o seletor.
  // O mesmo padrão de `registerRefresh` — o filho entrega a função, o shell
  // guarda a referência.
  const openDraft = useRef<(() => void) | null>(null);
  const registerOpenDraft = useCallback((open: () => void) => {
    openDraft.current = open;
  }, []);
  const handleCreateNote = useCallback(() => openDraft.current?.(), []);

  const pickFile = useRef<(() => void) | null>(null);
  const registerPickFile = useCallback((pick: () => void) => {
    pickFile.current = pick;
  }, []);
  const handlePickFile = useCallback(() => pickFile.current?.(), []);

  const greeting = greetingFor(hour);
  const name = firstName(userName);

  return (
    <div className="flex h-dvh overflow-hidden bg-secondary">
      <Sidebar
        open={sidebarOpen}
        drawerOpen={drawerOpen}
        onCloseDrawer={closeDrawer}
        workspaces={workspaces}
        // Nenhum workspace está aberto: o lugar em que a pessoa está é o
        // Início, e é ele que aparece como aba ativa na barra ao lado.
        activeWorkspaceId={null}
        onCreateWorkspace={() => {
          closeDrawer();
          startCreating();
        }}
        onDeleteWorkspace={handleDeleteWorkspace}
        onOpenWorkspace={openTab}
        onRenameWorkspace={handleRenameWorkspace}
        userName={userName}
        userEmail={userEmail}
        unreadCount={unreadCount}
      />

      {/* `p-3` e não `px-3 pb-3`: sem o respiro em cima, a barra de abas —
          onde fica o nome do workspace — encostava na borda da janela. */}
      <div className="flex min-w-0 flex-1 flex-col p-3">
        {/* Barra de abas. A aba ativa desce um pixel sobre a borda do painel
            para os dois lerem como uma peça só — a janela e sua etiqueta. */}
        <div className="flex h-12 shrink-0 items-end gap-1">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={sidebarOpen || drawerOpen}
            aria-label={
              sidebarOpen ? "Recolher navegação" : "Expandir navegação"
            }
            className="mb-1.5 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
          >
            <PanelLeft className="size-[18px]" aria-hidden="true" />
          </button>

          {/* O caminho de volta ao Início.
              Só aparece quando a aba do Início foi fechada — enquanto ela
              está lá, duas representações do mesmo lugar lado a lado seriam
              ruído. Ele nasce no instante em que a pessoa fecha a aba, que é
              exatamente quando ela precisa saber que o caminho continua
              existindo. */}
          {!tabs.includes(HOME_TAB) && (
            <button
              type="button"
              onClick={() => openTab(HOME_TAB)}
              title="Abrir a aba Início"
              className="mb-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
            >
              <House className="size-[18px]" aria-hidden="true" />
              <span className="sr-only">Abrir a aba Início</span>
            </button>
          )}

          {/* Não são abas no sentido do ARIA: são lugares. Cada workspace tem
              rota própria, e a aba ativa é o Início — a tela em que a pessoa
              está agora. Marcar isto como `tablist` seria mentir para o
              leitor de tela: não há painel nenhum sendo trocado aqui, há
              navegação.

              A lista é a das abas abertas, não a de todos os workspaces. A
              lista completa está no trilho, ao lado; esta barra é o que a
              pessoa deixou à mão. */}
          <nav
            aria-label="Abas abertas"
            className="flex min-w-0 items-end gap-1 overflow-x-auto"
          >
            {tabs.map((id) => {
              if (id === HOME_TAB) {
                return (
                  <Tab
                    key={id}
                    active
                    label="Início"
                    closeHint="O dashboard continua em /dashboard e no trilho."
                    onClose={() => closeTab(HOME_TAB)}
                  />
                );
              }

              const workspace = workspaces.find((item) => item.id === id);
              if (!workspace) return null;

              return (
                <Tab
                  key={id}
                  href={`/workspace/${workspace.id}`}
                  label={workspace.name}
                  closeHint="O workspace continua na sua conta, no trilho ao lado."
                  onClose={() => closeTab(workspace.id)}
                />
              );
            })}

            {creating ? (
              <span className="mb-1 flex h-8 items-center">
                <input
                  ref={draftRef}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={commitCreate}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void commitCreate();
                    if (event.key === "Escape") setCreating(false);
                  }}
                  maxLength={60}
                  placeholder="Nome do workspace"
                  aria-label="Nome do novo workspace"
                  className="h-8 w-[172px] rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-subtle-foreground focus:border-subtle-foreground"
                />
              </span>
            ) : (
              <button
                type="button"
                onClick={startCreating}
                title="Novo workspace"
                className="mb-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
              >
                <Plus className="size-4" aria-hidden="true" />
                <span className="sr-only">Novo workspace</span>
              </button>
            )}
          </nav>

          {createError && (
            <p className="mb-2 ml-2 text-xs text-error">{createError}</p>
          )}
        </div>

        {/* A janela */}
        <main className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-background">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-14 sm:py-20">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-xl bg-accent text-sm font-bold text-accent-foreground font-[family-name:var(--font-display)]"
              >
                n.
              </span>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
                {greeting}
                {name ? `, ${name}` : ""}
              </h1>
            </div>

            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
              Jogue o que chegou aqui dentro. A Nexo lê, classifica e guarda —
              você só volta quando precisar reencontrar.
            </p>

            <div className="mt-7">
              <CommandBar
                onOpenNote={handleOpenNote}
                onUploaded={handleUploaded}
                registerPickFile={registerPickFile}
              />
              {/* O rascunho fica logo abaixo da barra por ser o outro lado
                  da mesma moeda: ali em cima entra o que já está pronto para
                  a Nexo ler e classificar, aqui embaixo o que ainda não é
                  nada. */}
              <DraftNote
                onSaved={handleDraftSaved}
                registerOpen={registerOpenDraft}
              />
            </div>

            <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <TasksPanel
                initial={jobs}
                renderedAt={renderedAt}
                now={now}
                registerRefresh={registerRefresh}
                onUpload={handlePickFile}
              />
              <RecentPanel
                initial={notes}
                renderedAt={renderedAt}
                now={now}
                workspaces={workspaces}
                onOpenNote={handleOpenNote}
                onCreateNote={handleCreateNote}
              />
            </div>
          </div>
        </main>
      </div>

      {/* Aviso transitório. `polite` porque interrompe leitura de tela é pior
          que esperar a frase atual terminar. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
      >
        <p
          className={cn(
            "flex max-w-[min(38rem,100%)] items-center gap-2 border border-border bg-background px-4 py-2 text-sm text-foreground",
            "shadow-[0_8px_28px_-10px] shadow-black/35",
            "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
            // O aviso do plano carrega link e um "×", então ele é um bloco com
            // cantos suaves; o aviso comum continua a pílula de sempre.
            notice?.upgrade ? "rounded-2xl" : "rounded-full",
            notice
              ? "pointer-events-auto translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0"
          )}
        >
          <span className="min-w-0">
            {notice?.message ?? ""}
            {notice?.upgrade && (
              <>
                {" "}
                <UpgradeLink />
              </>
            )}
          </span>

          {/* Sem auto-dismiss, o aviso do plano precisa de uma saída própria. */}
          {notice?.upgrade && (
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Fechar o aviso</span>
            </button>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Uma aba da barra de cima.
 *
 * A ativa desce um pixel sobre a borda do painel para as duas lerem como uma
 * peça só — a janela e sua etiqueta.
 *
 * **Fechar não é excluir**, e o desenho precisa dizer isso sem uma linha de
 * texto: o "×" tira o atalho da barra e o workspace continua inteiro no
 * trilho, ao lado. Daí ele ser discreto e só aparecer quando o ponteiro
 * chega — e daí, também, o motivo pelo qual a exclusão de verdade mora no
 * menu do botão direito, atrás de uma confirmação, e não aqui.
 *
 * Num aparelho de toque não existe "passar por cima": lá o alvo fica de pé o
 * tempo todo, no tamanho que um dedo alcança.
 */
function Tab({
  active,
  href,
  label,
  closeHint,
  onClose,
}: {
  active?: boolean;
  /** Ausente na aba do lugar em que a pessoa já está. */
  href?: string;
  label: string;
  /** O que **não** acontece ao fechar. Vai para o `title` do "×". */
  closeHint: string;
  onClose: () => void;
}) {
  const shared = cn(
    "block max-w-[200px] truncate pr-8 pl-3 text-sm",
    active
      ? "h-9 rounded-t-xl border border-b-0 border-border bg-background leading-9 font-medium text-foreground"
      : "h-8 rounded-lg leading-8 text-muted-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground"
  );

  return (
    <span
      className={cn(
        "group/tab relative shrink-0",
        active ? "z-10 -mb-px" : "mb-1"
      )}
    >
      {href ? (
        <Link href={href} title={`Abrir a lousa de ${label}`} className={shared}>
          {label}
        </Link>
      ) : (
        <span aria-current="page" className={shared}>
          {label}
        </span>
      )}

      <button
        type="button"
        onClick={onClose}
        title={`Fechar a aba ${label} — ${closeHint}`}
        className={cn(
          "absolute right-1 flex size-6 items-center justify-center rounded-md",
          "text-subtle-foreground opacity-0 transition-opacity duration-150",
          "hover:bg-tertiary hover:text-foreground group-hover/tab:opacity-100",
          "focus-visible:opacity-100 pointer-coarse:opacity-100",
          "motion-reduce:transition-none",
          active ? "top-1.5" : "top-1"
        )}
      >
        <X className="size-3.5" aria-hidden="true" />
        <span className="sr-only">Fechar a aba {label}</span>
      </button>
    </span>
  );
}
