import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { sweepPendingNotes } from "@/lib/ai/note-reading";
import {
  listAiJobs,
  listRecentNotes,
  listTopTags,
  listWorkspaces,
  type WorkspaceSummary,
} from "@/lib/dashboard/queries";
import { db } from "@/lib/db";
import { profiles, workspaces } from "@/lib/db/schema";
import { countUnreadNotifications } from "@/lib/inbox/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Dashboard — Nexo",
};

/** Nome do workspace que todo usuário ganha ao entrar pela primeira vez. */
const DEFAULT_WORKSPACE_NAME = "Dashboard";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // O layout já barrou, mas a página não assume nada sobre isso: sem usuário,
  // nenhuma consulta roda.
  if (!user) redirect("/login");

  const [profile] = await db
    .select({ displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  let workspaceList = await listWorkspaces(user.id);

  // Primeiro acesso: a pessoa precisa ter onde estar antes de ter o que
  // guardar. O workspace padrão nasce aqui, não numa tela de onboarding —
  // o produto não cobra decisão de organização na entrada.
  if (workspaceList.length === 0) {
    workspaceList = await createDefaultWorkspace(user.id);
  }

  // A rede de segurança da leitura por IA: a nota cuja aba fechou antes de
  // qualquer gatilho chegar é apanhada aqui, fora da resposta. No máximo duas
  // por carga, por índice parcial — nunca uma varredura da tabela.
  const ownerId = user.id;
  after(async function sweepNotesAfterRender() {
    await sweepPendingNotes(ownerId);
  });

  const [jobs, notes, topTags, unreadCount] = await Promise.all([
    listAiJobs(user.id),
    listRecentNotes(user.id),
    listTopTags(user.id),
    countUnreadNotifications(user.id),
  ]);

  // Server Component dinâmico: este instante é dado da requisição, não
  // estado de render do React. A regra de pureza mira componentes de
  // cliente, onde uma leitura de relógio no render quebraria a hidratação —
  // aqui ela é justamente o que mantém servidor e cliente sincronizados.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();

  return (
    <DashboardShell
      userName={profile?.displayName ?? null}
      userEmail={user.email ?? ""}
      workspaces={workspaceList}
      jobs={jobs}
      notes={notes}
      topTags={topTags}
      renderedAt={renderedAt}
      serverHour={new Date(renderedAt).getHours()}
      unreadCount={unreadCount}
    />
  );
}

/**
 * Cria o workspace padrão e relê a lista.
 *
 * Duas abas abertas no primeiro acesso executariam isto ao mesmo tempo. A
 * releitura depois do insert é o que mantém a interface honesta nesse caso:
 * ela mostra o que o banco tem, não o que esta requisição achou que criou.
 */
async function createDefaultWorkspace(
  userId: string
): Promise<WorkspaceSummary[]> {
  try {
    await db.insert(workspaces).values({
      userId,
      name: DEFAULT_WORKSPACE_NAME,
      isDefault: true,
    });
  } catch {
    // Corrida com outra aba: a releitura abaixo resolve.
  }

  return listWorkspaces(userId);
}
