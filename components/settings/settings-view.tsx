"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  LogIn,
  Settings,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ErrorCodeChip, ErrorReport } from "@/components/errors/error-report";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBoardRichEditor } from "@/hooks/use-board-rich-editor";
import { useHideDraft } from "@/hooks/use-hide-draft";
import { useKnownAccounts } from "@/hooks/use-known-accounts";
import { forgetAccount, rememberAccount } from "@/lib/accounts";
import type { OwnErrorReport } from "@/lib/errors/queries";
import { writeBoardRichEditor, writeHideDraft } from "@/lib/preferences";
import type { UsageSnapshot } from "@/lib/usage/queries";
import { cn, formatBytes } from "@/lib/utils";

/**
 * A página de configurações da conta.
 *
 * Mesma "janela" do dashboard e da página de Tags — moldura arredondada sobre
 * o fundo secundário — para ler como mais um cômodo da mesma casa. Quatro
 * abas: "Uso" com o consumo contra os tetos do plano, "Conta" com a
 * identidade, "Erros" com o que quebrou nesta conta e "Preferências" com as
 * escolhas de interface que moram no navegador.
 */

interface SettingsViewProps {
  userId: string;
  userName: string | null;
  userEmail: string;
  /** ISO de `profiles.created_at`, ou `null` se o perfil ainda não existe. */
  memberSince: string | null;
  usage: UsageSnapshot;
  /** Os relatórios de erro desta conta — só as colunas seguras. */
  errorReports: OwnErrorReport[];
}

type TabId = "uso" | "conta" | "erros" | "preferencias";

export function SettingsView({
  userId,
  userName,
  userEmail,
  memberSince,
  usage,
  errorReports,
}: SettingsViewProps) {
  // Abre em "Uso": é o que esta tela ganhou de novo, e "Conta" ainda é só
  // leitura.
  const [tab, setTab] = useState<TabId>("uso");

  return (
    <div className="flex min-h-dvh bg-secondary p-3">
      <main className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-background">
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-6 py-10 sm:py-14">
          <Link
            href="/dashboard"
            className="flex w-fit items-center gap-1.5 rounded-lg py-1 pr-2 text-sm text-subtle-foreground transition-colors duration-150 hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Início
          </Link>

          <div className="mt-6 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground"
            >
              <Settings className="size-[18px]" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
              Configurações
            </h1>
          </div>

          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
            A sua conta, o que você guardou neste mês, o que falhou por aqui
            e as preferências deste navegador.
          </p>

          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as TabId)}
            className="mt-8"
          >
            <TabsList aria-label="Seções das configurações">
              <TabsTrigger value="uso">Uso</TabsTrigger>
              <TabsTrigger value="conta">Conta</TabsTrigger>
              <TabsTrigger value="erros">Erros</TabsTrigger>
              <TabsTrigger value="preferencias">Preferências</TabsTrigger>
            </TabsList>

            <TabsContent value="uso" className="mt-8">
              <UsagePanel usage={usage} />
            </TabsContent>

            <TabsContent value="conta" className="mt-8">
              <AccountPanel
                userId={userId}
                userName={userName}
                userEmail={userEmail}
                memberSince={memberSince}
              />
            </TabsContent>

            <TabsContent value="erros" className="mt-8">
              <ErrorsPanel reports={errorReports} />
            </TabsContent>

            <TabsContent value="preferencias" className="mt-8">
              <PreferencesPanel />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

const resetDateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  // O corte é 00:00 UTC (o mesmo de `date_trunc('month')`). Formatar em UTC
  // evita mostrar o último dia do mês corrente por causa do fuso.
  timeZone: "UTC",
});

const memberSinceFormat = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

/**
 * A aba "Uso".
 *
 * Eram medidores com barra contra o teto de cada plano. Não existe mais plano
 * nem teto: cada pessoa sobe a própria instância e paga o próprio Supabase,
 * então o número aqui é **informação sobre o seu acervo**, não um saldo
 * correndo para o fim. Uma barra sem limite seria uma barra mentindo sobre
 * existir um.
 */
function UsagePanel({ usage }: { usage: UsageSnapshot }) {
  const { captures, storageBytes, workspaces, capturesResetAt } = usage;

  return (
    <div className="space-y-6">
      <dl className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
        <Stat
          label="Capturas neste mês"
          value={captures.total.toLocaleString("pt-BR")}
          detail={`${captures.notes} ${
            captures.notes === 1 ? "nota" : "notas"
          } · ${captures.uploads} ${
            captures.uploads === 1 ? "arquivo" : "arquivos"
          } · zera em ${resetDateFormat.format(new Date(capturesResetAt))}`}
        />
        <Stat
          label="Armazenamento"
          value={formatBytes(storageBytes)}
          detail="Ocupado no bucket do seu projeto Supabase."
        />
        <Stat
          label="Workspaces"
          value={workspaces.toLocaleString("pt-BR")}
        />
      </dl>

      <p className="text-xs leading-relaxed text-subtle-foreground">
        Nenhum destes números tem teto na aplicação. Quem limita é o plano do
        seu projeto Supabase e o provedor de IA que você configurou.
      </p>
    </div>
  );
}

/** Uma linha de número na aba "Uso". */
function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 bg-secondary/40 px-4 py-3.5">
      <div className="min-w-0">
        <dt className="text-sm font-medium text-foreground">{label}</dt>
        {detail && (
          <dd className="mt-0.5 text-xs leading-relaxed text-subtle-foreground">
            {detail}
          </dd>
        )}
      </div>
      <dd className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function AccountPanel({
  userId,
  userName,
  userEmail,
  memberSince,
}: {
  userId: string;
  userName: string | null;
  userEmail: string;
  memberSince: string | null;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Nome", value: userName?.trim() || "—" },
    { label: "E-mail", value: userEmail || "—" },
    {
      label: "Membro desde",
      value: memberSince
        ? memberSinceFormat.format(new Date(memberSince))
        : "—",
    },
  ];

  return (
    <div className="space-y-8">
      <dl className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 px-4 py-3.5"
          >
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 truncate text-sm text-foreground">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <AccountSwitcher userId={userId} userEmail={userEmail} userName={userName} />

      <DangerZone />
    </div>
  );
}

/* ---------------------------------------------------------------------- */

/**
 * Troca entre duas contas neste navegador.
 *
 * **Não é sessão dupla.** A Nexo mantém uma sessão por vez — o cookie do
 * Supabase é um só. Trocar de conta sai da atual (`POST /api/auth/logout`) e
 * leva ao login já com o e-mail da outra pronto (`lib/accounts.ts`); só a
 * senha continua sendo pedida de novo, porque ela nunca fica guardada aqui.
 */
function AccountSwitcher({
  userId,
  userEmail,
  userName,
}: {
  userId: string;
  userEmail: string;
  userName: string | null;
}) {
  const router = useRouter();
  const accounts = useKnownAccounts();
  const [switching, setSwitching] = useState(false);

  // Mantém esta conta na lista, com o nome mais recente — é aqui que ele
  // chega pela primeira vez (o login só tinha o e-mail).
  useEffect(() => {
    if (!userEmail) return;
    rememberAccount({ id: userId, email: userEmail, displayName: userName });
  }, [userId, userEmail, userName]);

  const other = accounts.find((account) => account.id !== userId) ?? null;

  async function switchAccount(email?: string) {
    setSwitching(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push(email ? `/login?email=${encodeURIComponent(email)}` : "/login");
    } catch {
      setSwitching(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-secondary/50 p-5">
      <h2 className="text-sm font-medium text-foreground">Trocar de conta</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        Este navegador lembra até duas contas. Trocar sai da sessão atual e
        volta ao login com o e-mail já preenchido.
      </p>

      <ul className="mt-4 space-y-2">
        <li className="flex items-center gap-3 rounded-xl border border-border bg-background px-3.5 py-3">
          <AccountAvatar label={userName?.trim() || userEmail} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {userName?.trim() || userEmail}
            </p>
            <p className="truncate text-xs text-subtle-foreground">
              {userEmail}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-tertiary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Esta sessão
          </span>
        </li>

        {other && (
          <li className="flex items-center gap-3 rounded-xl border border-border bg-background px-3.5 py-3">
            <AccountAvatar label={other.displayName?.trim() || other.email} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {other.displayName?.trim() || other.email}
              </p>
              <p className="truncate text-xs text-subtle-foreground">
                {other.email}
              </p>
            </div>
            <button
              type="button"
              onClick={() => switchAccount(other.email)}
              disabled={switching}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-semibold text-accent-foreground transition-[background-color,transform] duration-150 hover:bg-accent/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 motion-reduce:active:scale-100"
            >
              <ArrowRightLeft className="size-3" aria-hidden="true" />
              Trocar
            </button>
            <button
              type="button"
              onClick={() => forgetAccount(other.id)}
              title="Esquecer esta conta neste navegador"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition-colors duration-150 hover:bg-tertiary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Esquecer esta conta</span>
            </button>
          </li>
        )}
      </ul>

      {!other && (
        <button
          type="button"
          onClick={() => switchAccount()}
          disabled={switching}
          className="mt-3 flex h-9 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-tertiary disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11"
        >
          <LogIn className="size-3.5" aria-hidden="true" />
          Entrar com outra conta
        </button>
      )}
    </section>
  );
}

function AccountAvatar({ label }: { label: string }) {
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tertiary text-sm font-semibold text-foreground"
    >
      {initial}
    </span>
  );
}

/* ---------------------------------------------------------------------- */

const RESET_PHRASE = "apagar tudo";

/**
 * Recomeçar do zero.
 *
 * Apaga tudo o que a pessoa construiu — workspaces, notas, arquivos, a lousa,
 * as Tarefas e a Entrada — e mantém o login e o plano. É irreversível, então
 * o gatilho não é um clique: a pessoa digita a frase, e só então o botão
 * acende. A rota (`POST /api/account/reset`) confere a frase de novo.
 */
function DangerZone() {
  const [phrase, setPhrase] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armed = phrase.trim().toLowerCase() === RESET_PHRASE;

  async function handleReset() {
    if (!armed || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/account/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: phrase.trim() }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(data?.error ?? "Não foi possível apagar os dados.");
        setPending(false);
        return;
      }
      // Ambiente limpo: o dashboard recria um workspace padrão ao carregar.
      // `replace` para o botão "voltar" não trazer esta tela de volta.
      window.location.replace("/dashboard");
    } catch {
      setError("Sem conexão. Tente de novo.");
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-error/40 bg-error/5 p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-error/10 text-error"
        >
          <AlertTriangle className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">
            Recomeçar do zero
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Apaga <strong className="font-medium text-foreground">tudo</strong> o
            que você construiu: workspaces, notas, arquivos enviados, o arranjo
            das lousas, o feed de Tarefas e a Entrada. O seu login, o e-mail e o
            plano continuam como estão.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-error">
            Não dá para desfazer. Os arquivos saem do armazenamento e as notas
            não vão para lugar nenhum — somem.
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-error/25 pt-4">
        <label
          htmlFor="reset-confirm"
          className="text-xs text-muted-foreground"
        >
          Para confirmar, digite{" "}
          <span className="font-semibold text-foreground">{RESET_PHRASE}</span>{" "}
          abaixo.
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            id="reset-confirm"
            type="text"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={RESET_PHRASE}
            disabled={pending}
            className="h-9 w-44 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-subtle-foreground focus-visible:border-error/60"
          />
          <button
            type="button"
            onClick={handleReset}
            disabled={!armed || pending}
            className={cn(
              "inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold transition-colors duration-150 pointer-coarse:h-11",
              armed && !pending
                ? "bg-error text-white hover:bg-error/90"
                : "cursor-not-allowed bg-tertiary text-subtle-foreground"
            )}
          >
            {pending ? "Apagando…" : "Apagar tudo e recomeçar"}
          </button>
        </div>
        {error && (
          <p className="mt-2.5 text-xs font-medium text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------- */

/**
 * Preferências de interface — escolhas de vista que moram no `localStorage`
 * deste navegador (como o tema), não na conta. Trocá-las num aparelho não
 * mexe nos outros.
 */
function PreferencesPanel() {
  // A fonte é o `localStorage`; o hook mantém esta tela em sincronia com
  // outras abas e com a própria lousa.
  const boardRich = useBoardRichEditor();
  const hideDraft = useHideDraft();

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-secondary/50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">
              Editor rico na lousa
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Ao editar uma nota dentro de uma lousa, use o mesmo editor da
              nota inteira — títulos, listas, bloco de código, checklist — no
              lugar do campo de texto simples.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={boardRich}
            aria-label="Editor rico na lousa"
            onClick={() => writeBoardRichEditor(!boardRich)}
            className={cn(
              "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 motion-reduce:transition-none",
              boardRich ? "bg-accent" : "bg-tertiary"
            )}
          >
            <span
              className={cn(
                "inline-block size-5 rounded-full bg-background shadow-sm transition-transform duration-150 motion-reduce:transition-none",
                boardRich ? "translate-x-[22px]" : "translate-x-0.5"
              )}
            />
          </button>
        </div>

        <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-subtle-foreground">
          Pode pesar em lousas com muitas janelas ou em aparelhos mais fracos:
          o editor carrega o ProseMirror. Fora da lousa, a edição de nota já é
          sempre a completa.
        </p>
      </section>

      <section className="rounded-2xl border border-border bg-secondary/50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">
              Remover o rascunho do dashboard
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Some o convite &ldquo;Escrever um rascunho&rdquo; da tela
              inicial, para quem não usa esse atalho.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={hideDraft}
            aria-label="Remover o rascunho do dashboard"
            onClick={() => writeHideDraft(!hideDraft)}
            className={cn(
              "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 motion-reduce:transition-none",
              hideDraft ? "bg-accent" : "bg-tertiary"
            )}
          >
            <span
              className={cn(
                "inline-block size-5 rounded-full bg-background shadow-sm transition-transform duration-150 motion-reduce:transition-none",
                hideDraft ? "translate-x-[22px]" : "translate-x-0.5"
              )}
            />
          </button>
        </div>

        <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-subtle-foreground">
          Um rascunho com texto ainda não guardado continua aparecendo — ele
          não pode ficar escondido atrás de uma preferência.
        </p>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

const ERROR_KIND_LABEL: Record<OwnErrorReport["kind"], string> = {
  api: "No servidor",
  client: "No navegador",
  ai_job: "Na classificação por IA",
  unhandled: "Inesperado",
};

const errorDateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * "Meus erros" — o que quebrou nesta conta, e em que pé está.
 *
 * **Ela existe para fechar o ciclo.** Sem esta aba, apertar "Reportar" num
 * aviso que some em três segundos é escrever para um endereço que a pessoa
 * não sabe se existe. Aqui ela vê o relato dela registrado, com o código do
 * lado, e vê quando alguém marcou como resolvido — que é a única prova de que
 * a mensagem chegou a algum lugar.
 *
 * **O que ela não mostra: o erro.** Nem mensagem, nem stack, nem contexto —
 * nada disso sai do servidor, por duas travas independentes (o `select` de
 * `lib/errors/queries.ts` e o `GRANT` por coluna de 0015). Mostrar stack
 * trace ao usuário é o item 8 da tabela de problemas comuns do `AGENTS.md`, e
 * não vira boa ideia por o usuário ser o dono da linha.
 *
 * O que sobra é o que serve para ele: o código para citar, quando foi,
 * quantas vezes, e o estado do chamado.
 */
function ErrorsPanel({ reports }: { reports: OwnErrorReport[] }) {
  if (reports.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-secondary/50 p-8 text-center">
        <h2 className="text-sm font-medium text-foreground">
          Nenhum erro registrado
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          É o estado que a gente quer. Se alguma coisa falhar, ela aparece aqui
          com um código — e daí você pode nos contar o que estava fazendo.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-muted-foreground">
        O que falhou por aqui. Cada linha tem um código: cite ele no suporte e
        a gente encontra exatamente o que o servidor viu naquele momento.
      </p>

      <ul className="space-y-2">
        {reports.map((report) => (
          <li
            key={report.code}
            className="rounded-2xl border border-border bg-secondary/50 p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-medium text-foreground">
                {ERROR_KIND_LABEL[report.kind]}
              </h3>
              <ErrorStatus report={report} />
            </div>

            <p className="mt-1 text-xs text-subtle-foreground">
              {errorDateFormat.format(new Date(report.lastSeenAt))}
              {report.occurrences > 1
                ? ` · ${report.occurrences} vezes no mesmo dia`
                : ""}
            </p>

            {report.userReport && (
              <p className="mt-2.5 border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">
                {report.userReport}
              </p>
            )}

            {/* Já reportado não ganha o botão de novo: um segundo relato
                sobrescreveria o primeiro, e ver "Reportar" ali sugeriria que
                o primeiro não chegou. O código continua copiável — é ele que
                a pessoa precisa ter à mão. */}
            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>Código:</span>
              <ErrorCodeChip code={report.code} />
            </p>

            {!report.userReportedAt && (
              <ErrorReport
                className="mt-2"
                code={report.code}
                route={report.route}
                showCode={false}
                compact
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Reportado, resolvido, ou nem uma coisa nem outra. */
function ErrorStatus({ report }: { report: OwnErrorReport }) {
  if (report.resolvedAt) {
    return (
      <span className="rounded-full bg-tag-3 px-2 py-0.5 text-[11px] text-tag-3-foreground">
        Resolvido
      </span>
    );
  }
  if (report.userReportedAt) {
    return (
      <span className="rounded-full bg-tag-4 px-2 py-0.5 text-[11px] text-tag-4-foreground">
        Enviado — estamos vendo
      </span>
    );
  }
  return (
    <span className="text-[11px] text-subtle-foreground">Não reportado</span>
  );
}
