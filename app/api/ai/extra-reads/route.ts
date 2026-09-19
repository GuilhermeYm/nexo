import { and, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";

import { readNotes, releaseExtraReads } from "@/lib/ai/note-reading";
import { errorResponse, logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({ notificationId: z.string().uuid() });

const actionSchema = z.object({
  type: z.literal("ai-extra-reads"),
  noteIds: z.array(z.string().uuid()).min(1).max(50),
});

/** Quantas leituras disparam na hora; o resto fica para a varredura. */
const READ_NOW = 10;

/**
 * O botão "Ler mesmo assim" de um aviso de limite, na Entrada.
 *
 * **O que se libera vem da notificação, não do corpo.** O cliente manda só o
 * id do aviso; as notas saem do `metadata` que o servidor escreveu (ninguém
 * mais escreve em `notifications` — 0011). Assim um pedido forjado não libera
 * leituras para notas arbitrárias, e cada aviso libera uma vez só.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse(401, "Não autenticado.");
    userId = user.id;

    const limit = await rateLimit({
      key: `ai:extra-reads:${user.id}`,
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });
    if (!limit.success) {
      return errorResponse(429, "Muitos pedidos seguidos. Aguarde um pouco.");
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse(400, "Aviso inválido.");

    const [notification] = await db
      .select({ id: notifications.id, metadata: notifications.metadata })
      .from(notifications)
      .where(
        and(
          eq(notifications.id, parsed.data.notificationId),
          eq(notifications.userId, user.id)
        )
      )
      .limit(1);
    if (!notification) return errorResponse(404, "Aviso não encontrado.");

    const metadata = (notification.metadata ?? {}) as Record<string, unknown>;
    if (metadata.actionTakenAt) {
      return errorResponse(409, "Estas leituras já foram liberadas.");
    }
    const action = actionSchema.safeParse(metadata.action);
    if (!action.success) return errorResponse(400, "Este aviso não tem essa ação.");

    const pending = await releaseExtraReads(user.id, action.data.noteIds);

    // Uma vez só: o aviso guarda que a ação foi tomada, e vira lido.
    await db
      .update(notifications)
      .set({
        metadata: { ...metadata, actionTakenAt: new Date().toISOString() },
        read: true,
        readAt: new Date(),
      })
      .where(and(eq(notifications.id, notification.id), eq(notifications.userId, user.id)));

    const ownerId = user.id;
    // `readNotes`, e não uma a uma: as que só precisam de tags vão juntas
    // numa chamada (docs/IA-LEITURA.md §6.2).
    after(async function readReleasedNotes() {
      await readNotes(ownerId, pending.slice(0, READ_NOW), { request });
    });

    return NextResponse.json({ released: action.data.noteIds.length, reading: pending.length });
  } catch (error) {
    const code = await logServerError("POST /api/ai/extra-reads", error, { userId }, request);
    return errorResponse(500, "Erro ao liberar as leituras.", code);
  }
}
