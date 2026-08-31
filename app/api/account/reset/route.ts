import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, logServerError } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  aiJobs,
  attachments,
  errorReports,
  notes,
  notifications,
  tags,
  workspaceConnections,
  workspaceWindows,
  workspaces,
} from "@/lib/db/schema";
import { notifySystem } from "@/lib/inbox/notify";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * Recomeçar do zero — apaga tudo o que a pessoa construiu e deixa a conta.
 *
 * **O que some:** workspaces, notas, tags, anexos (metadados e os arquivos no
 * Storage), a lousa inteira de cada workspace (janelas e ligações), o feed de
 * Tarefas, as notificações da Entrada e os relatórios de erro da conta.
 *
 * **O que fica:** o login e o cadastro. A linha de `profiles` não é tocada —
 * nome, avatar, plano e os campos de assinatura do Stripe são identidade da
 * conta, não conteúdo. `audit_logs` também fica: é a trilha que existe para
 * tornar justamente esta ação investigável depois, e esta rota escreve nela.
 *
 * Depois disto o dashboard recria sozinho um workspace padrão no próximo
 * carregamento (ver `app/dashboard/page.tsx`), então a pessoa cai num
 * ambiente limpo, não numa tela quebrada.
 *
 * **Atômico.** Os `DELETE` correm dentro de uma transação: um apagão pela
 * metade — workspaces de pé sem as notas, ou o contrário — seria pior que
 * não ter apagado nada. O Storage vem depois do commit (não há como desfazê-lo
 * numa transação); se a remoção falhar, os arquivos ficam órfãos e inofensivos
 * — a conta de armazenamento sai de `attachments`, que já não existe mais.
 */

const BUCKET = "files";

/**
 * A frase que o corpo precisa trazer. A interface faz a pessoa digitá-la; a
 * rota confere de novo, porque uma ação irreversível não pode depender só de
 * um botão do cliente ter sido clicado com cuidado.
 */
const CONFIRM_PHRASE = "apagar tudo";

const bodySchema = z.object({
  confirm: z.string().min(1).max(100),
});

/** Remove os arquivos do Storage em lotes; nunca derruba a resposta. */
async function removeStorageObjects(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: string[],
  userId: string
): Promise<void> {
  const CHUNK = 100;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const slice = paths.slice(i, i + CHUNK);
    const { error } = await supabase.storage.from(BUCKET).remove(slice);
    if (error) {
      logServerError("POST /api/account/reset (storage)", error, {
        userId,
        pending: paths.length - i,
      });
      return;
    }
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    // Ação catastrófica e irreversível: teto baixo. Repeti-la não causa dano
    // (a segunda passada não acha nada), mas não há motivo para um laço.
    const limit = await rateLimit({
      key: `account:reset:${user.id}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitas tentativas seguidas. Aguarde um pouco.");
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return errorResponse(400, "Confirmação ausente.");
    }
    if (parsed.data.confirm.trim().toLowerCase() !== CONFIRM_PHRASE) {
      return errorResponse(
        400,
        `Para confirmar, digite exatamente "${CONFIRM_PHRASE}".`
      );
    }

    // Os caminhos do Storage saem antes do DELETE — depois dele a linha de
    // `attachments` já não existe para dizer onde o arquivo mora.
    const files = await db
      .select({ storagePath: attachments.storagePath })
      .from(attachments)
      .where(eq(attachments.userId, user.id));
    const storagePaths = files.map((row) => row.storagePath);

    // Tudo numa transação. A ordem respeita as chaves estrangeiras mesmo
    // sabendo que quase todas são `CASCADE`/`SET NULL`: ligações antes das
    // janelas, janelas antes de notas/anexos/workspaces.
    const deleted = await db.transaction(async (tx) => {
      const connections = await tx
        .delete(workspaceConnections)
        .where(eq(workspaceConnections.userId, user.id))
        .returning({ id: workspaceConnections.id });

      const windows = await tx
        .delete(workspaceWindows)
        .where(eq(workspaceWindows.userId, user.id))
        .returning({ id: workspaceWindows.id });

      const jobs = await tx
        .delete(aiJobs)
        .where(eq(aiJobs.userId, user.id))
        .returning({ id: aiJobs.id });

      // `note_tags` cai por cascata daqui e de `tags`.
      const removedAttachments = await tx
        .delete(attachments)
        .where(eq(attachments.userId, user.id))
        .returning({ id: attachments.id });

      const removedNotes = await tx
        .delete(notes)
        .where(eq(notes.userId, user.id))
        .returning({ id: notes.id });

      const removedTags = await tx
        .delete(tags)
        .where(eq(tags.userId, user.id))
        .returning({ id: tags.id });

      const removedWorkspaces = await tx
        .delete(workspaces)
        .where(eq(workspaces.userId, user.id))
        .returning({ id: workspaces.id });

      const removedNotifications = await tx
        .delete(notifications)
        .where(eq(notifications.userId, user.id))
        .returning({ id: notifications.id });

      // Relatório de erro é conteúdo da conta, não trilha de auditoria: ele
      // guarda o que **a pessoa escreveu** sobre o que estava fazendo, e
      // "recomeçar do zero" precisa alcançar isso. `audit_logs` é que fica —
      // é a trilha que torna esta ação investigável, inclusive contra nós.
      const removedErrorReports = await tx
        .delete(errorReports)
        .where(eq(errorReports.userId, user.id))
        .returning({ id: errorReports.id });

      return {
        workspaces: removedWorkspaces.length,
        notes: removedNotes.length,
        tags: removedTags.length,
        attachments: removedAttachments.length,
        windows: windows.length,
        connections: connections.length,
        aiJobs: jobs.length,
        notifications: removedNotifications.length,
        errorReports: removedErrorReports.length,
      };
    });

    await removeStorageObjects(supabase, storagePaths, user.id);

    // A ação mais destrutiva do produto — auditada sempre. `old_data` guarda o
    // tamanho do que foi destruído, que é o que uma investigação quer primeiro.
    await writeAuditLog({
      action: "PURGE",
      tableName: "account",
      recordId: user.id,
      userId: user.id,
      oldData: { ...deleted, storageObjects: storagePaths.length },
      request,
    });

    // A Entrada não volta vazia: um registro do que aconteceu, pela mesma
    // porta de qualquer aviso de sistema. Não lança.
    await notifySystem({
      userId: user.id,
      title: "Seu ambiente foi zerado",
      body: "Workspaces, notas, arquivos e a lousa foram apagados a seu pedido. O login e o plano continuam como estavam. É só começar de novo.",
      metadata: { kind: "account_reset" },
    });

    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    const code = await logServerError("POST /api/account/reset", error, { userId }, request);
    return errorResponse(500, "Não foi possível apagar os dados. Tente de novo.", code);
  }
}
