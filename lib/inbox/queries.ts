import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

/**
 * Leituras da Entrada (notificações).
 *
 * Vivem fora das rotas porque tanto o Server Component da página quanto as
 * API routes precisam das mesmas consultas. Toda função recebe `userId` já
 * derivado de `auth.getUser()`.
 */

export interface NotificationItem {
  id: string;
  type: "system" | "user";
  title: string;
  body: string | null;
  metadata: unknown;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Lista todas as notificações do usuário, das mais recentes para as mais
 * antigas. Não filtra por lida/não lida — a página mostra tudo e deixa o
 * cliente agrupar visualmente.
 */
export async function listNotifications(
  userId: string
): Promise<NotificationItem[]> {
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      metadata: notifications.metadata,
      read: notifications.read,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt));
}

/**
 * Quantas notificações ainda não foram lidas. Usada pelo badge no trilho.
 */
export async function countUnreadNotifications(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));

  return row?.count ?? 0;
}

/**
 * Marca uma notificação específica como lida ou não lida.
 */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
  read: boolean
): Promise<boolean> {
  const [updated] = await db
    .update(notifications)
    .set({
      read,
      readAt: read ? new Date() : null,
    })
    .where(
      and(eq(notifications.id, notificationId), eq(notifications.userId, userId))
    )
    .returning({ id: notifications.id });

  return updated !== undefined;
}

/**
 * Marca todas as notificações não lidas do usuário como lidas.
 */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await db
    .update(notifications)
    .set({
      read: true,
      readAt: new Date(),
    })
    .where(
      and(eq(notifications.userId, userId), eq(notifications.read, false))
    );

  return result.rowCount ?? 0;
}
