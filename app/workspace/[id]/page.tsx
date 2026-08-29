import { notFound, redirect } from "next/navigation";

import { Board } from "@/components/workspace/board";
import { windowCapFor } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import {
  getOwnedWorkspace,
  getUserPlan,
  readBoard,
} from "@/lib/workspace/queries";

export const metadata = {
  title: "Workspace — Nexo",
};

/** O `id` vem da URL. Antes de virar comparação com uma coluna uuid, é texto. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A lousa de um workspace.
 *
 * O primeiro estado é pintado aqui, no servidor: quem abre a página vê as
 * janelas onde elas estão — **e as flechas entre elas já desenhadas** —, sem
 * um quadro de lousa vazia antes. Daí em diante o cliente assume, e o
 * Realtime avisa quando outro dispositivo mexe.
 *
 * As ligações não têm carregamento próprio de propósito: elas vêm na mesma
 * leitura das janelas, no mesmo `await`, e chegam prontas no primeiro paint.
 * Um "carregando ligações…" seria anunciar uma espera que não existe.
 */
export default async function WorkspacePage(
  props: PageProps<"/workspace/[id]">
) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  // Lido aqui e não por `useSearchParams` no cliente: um parâmetro que só
  // decide o enquadramento inicial não justifica uma fronteira de Suspense.
  const focus = (await props.searchParams).focus;
  const focusWindowId = typeof focus === "string" && UUID.test(focus) ? focus : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // O layout já barrou, mas a página não assume nada sobre isso.
  if (!user) redirect("/login");

  // 404 e não 403 quando o workspace é de outra pessoa: confirmar que ele
  // existe já seria vazar informação.
  const workspace = await getOwnedWorkspace(user.id, id);
  if (!workspace) notFound();

  const [board, plan] = await Promise.all([
    readBoard(user.id, id),
    getUserPlan(user.id),
  ]);

  return (
    <Board
      workspace={workspace}
      initialWindows={board.windows}
      initialConnections={board.connections}
      focusWindowId={focusWindowId}
      windowCap={windowCapFor(plan)}
    />
  );
}
