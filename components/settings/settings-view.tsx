"use client";

import { ArrowLeft, Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UsageSnapshot } from "@/lib/usage/queries";
import { cn, formatBytes } from "@/lib/utils";

/**
 * A página de configurações da conta.
 *
 * Mesma "janela" do dashboard e da página de Tags — moldura arredondada sobre
 * o fundo secundário — para ler como mais um cômodo da mesma casa. Duas abas:
 * "Conta" com a identidade, e "Uso" com o consumo contra os tetos do plano.
 */

interface SettingsViewProps {
  userName: string | null;
  userEmail: string;
  /** ISO de `profiles.created_at`, ou `null` se o perfil ainda não existe. */
  memberSince: string | null;
  usage: UsageSnapshot;
}

type TabId = "uso" | "conta";

export function SettingsView({
  userName,
  userEmail,
  memberSince,
  usage,
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
            A sua conta e quanto do plano você já usou neste mês.
          </p>

          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as TabId)}
            className="mt-8"
          >
            <TabsList aria-label="Seções das configurações">
              <TabsTrigger value="uso">Uso</TabsTrigger>
              <TabsTrigger value="conta">Conta</TabsTrigger>
            </TabsList>

            <TabsContent value="uso" className="mt-8">
              <UsagePanel usage={usage} />
            </TabsContent>

            <TabsContent value="conta" className="mt-8">
              <AccountPanel
                userName={userName}
                userEmail={userEmail}
                memberSince={memberSince}
                plan={usage.plan}
              />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

const PLAN_LABEL: Record<UsageSnapshot["plan"], string> = {
  free: "Gratuito",
  pro: "Pro",
  enterprise: "Enterprise",
};

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

function UsagePanel({ usage }: { usage: UsageSnapshot }) {
  const { plan, limits, captures, storageBytes, workspaces, capturesResetAt } =
    usage;
  const isFree = plan === "free";

  return (
    <div className="space-y-8">
      {/* Plano atual */}
      <section className="rounded-2xl border border-border bg-secondary/50 p-5">
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-semibold tracking-wide text-subtle-foreground uppercase">
            Plano atual
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-semibold",
              isFree
                ? "bg-tertiary text-muted-foreground"
                : "bg-accent text-accent-foreground"
            )}
          >
            {PLAN_LABEL[plan]}
          </span>
        </div>

        {isFree ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              O Pro tira os tetos abaixo: capturas ilimitadas, workspaces sem
              limite e 20 GB de arquivos.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Link
                href="/#planos"
                className="inline-flex h-9 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-foreground transition-colors duration-150 hover:bg-accent/90 pointer-coarse:h-11"
              >
                Ver planos
              </Link>
              <span className="text-xs text-subtle-foreground">
                O pagamento é liberado quando a integração com o Stripe estiver
                pronta.
              </span>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Sem tetos de captura ou de workspace. O armazenamento vai até 20 GB.
          </p>
        )}
      </section>

      {/* Medidores */}
      <div className="space-y-6">
        <Meter
          label="Capturas neste mês"
          used={captures.total}
          limit={limits.capturesPerMonth}
          detail={`${captures.notes} ${
            captures.notes === 1 ? "nota" : "notas"
          } · ${captures.uploads} ${
            captures.uploads === 1 ? "arquivo" : "arquivos"
          }`}
          footnote={`Zera em ${resetDateFormat.format(new Date(capturesResetAt))}.`}
          atLimitHint={
            isFree
              ? "Teto do mês atingido. No Pro as capturas são ilimitadas."
              : undefined
          }
        />

        <Meter
          label="Armazenamento"
          used={storageBytes}
          limit={limits.storageBytes}
          format={formatBytes}
          atLimitHint={isFree ? "Cheio. O Pro tem 20 GB." : undefined}
        />

        {/* `alarm={false}`: no Gratuito, 1 de 1 é o estado de repouso de toda
            conta — não é problema nenhum, e não pode nascer vermelho no
            primeiro dia. A linha diz o que o plano dá, e só. */}
        <Meter
          label="Workspaces"
          used={workspaces}
          limit={limits.workspaces}
          alarm={false}
          footnote={
            isFree ? "O Gratuito tem um; no Pro são ilimitados." : undefined
          }
        />
      </div>
    </div>
  );
}

/**
 * Um medidor: rótulo, "quanto de quanto", barra e as linhas de apoio.
 *
 * Quando o plano não impõe teto (`limit === null`) não há barra — uma barra
 * cheia ou vazia ali mentiria sobre existir um limite. No lugar, uma linha
 * dizendo isso.
 */
function Meter({
  label,
  used,
  limit,
  detail,
  footnote,
  atLimitHint,
  alarm = true,
  format = (value) => value.toLocaleString("pt-BR"),
}: {
  label: string;
  used: number;
  limit: number | null;
  detail?: string;
  footnote?: string;
  atLimitHint?: string;
  /**
   * Encostar no teto é um problema?
   *
   * Para capturas e armazenamento, sim: a próxima ação vai ser recusada. Para
   * workspaces no Gratuito, não — 1 de 1 é o estado de repouso de toda conta,
   * e alarmar sobre ele faria a tela nascer vermelha sem nada ter acontecido.
   */
  alarm?: boolean;
  format?: (value: number) => string;
}) {
  const unlimited = limit === null;
  const ratio = unlimited || limit === 0 ? 0 : used / limit;
  const pct = Math.min(100, Math.round(ratio * 100));
  const atLimit = alarm && !unlimited && used >= (limit as number);

  const fillColor = atLimit
    ? "bg-error"
    : alarm && ratio >= 0.8
      ? "bg-tag-5-foreground"
      : "bg-accent";

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">{label}</h2>
        <p className="shrink-0 text-sm tabular-nums text-muted-foreground">
          <span className={atLimit ? "font-semibold text-error" : "text-foreground"}>
            {format(used)}
          </span>
          {unlimited ? (
            <span className="text-subtle-foreground"> · sem limite</span>
          ) : (
            <span className="text-subtle-foreground"> de {format(limit as number)}</span>
          )}
        </p>
      </div>

      {unlimited ? (
        <p className="mt-2 text-xs text-subtle-foreground">
          Sem limite neste plano.
        </p>
      ) : (
        <div
          className="mt-2.5 h-2 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={limit as number}
          aria-valuenow={Math.min(used, limit as number)}
          aria-label={label}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
              fillColor
            )}
            // Um fio de barra quando há qualquer uso, para "1 de 50" não sumir.
            style={{ width: used > 0 ? `${Math.max(pct, 2)}%` : "0%" }}
          />
        </div>
      )}

      {(detail || footnote) && (
        <p className="mt-2 text-xs text-subtle-foreground">
          {detail}
          {detail && footnote ? " · " : ""}
          {footnote}
        </p>
      )}

      {atLimit && atLimitHint && (
        <p className="mt-1.5 text-xs font-medium text-error">{atLimitHint}</p>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------- */

function AccountPanel({
  userName,
  userEmail,
  memberSince,
  plan,
}: {
  userName: string | null;
  userEmail: string;
  memberSince: string | null;
  plan: UsageSnapshot["plan"];
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Nome", value: userName?.trim() || "—" },
    { label: "E-mail", value: userEmail || "—" },
    { label: "Plano", value: PLAN_LABEL[plan] },
    {
      label: "Membro desde",
      value: memberSince
        ? memberSinceFormat.format(new Date(memberSince))
        : "—",
    },
  ];

  return (
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
  );
}
