import "server-only";

import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { folders, noteFolders, notes } from "@/lib/db/schema";
import { folderKey, type FolderItem } from "@/lib/folders/types";

export { cleanFolderName, folderKey } from "@/lib/folders/types";

/**
 * Pastas de notas. Toda consulta cruza `user_id` mesmo com a RLS: a
 * `DATABASE_URL` pode passar por cima das policies (`docs/SECURITY.md`).
 *
 * A pertença mora em `note_folders`, nunca em `notes` — o trigger de
 * `updated_at` faria mover uma nota subi-la em Recentes (0026).
 */

/** As pastas da pessoa, com quantas notas vivas cada uma tem. */
export async function listFolders(userId: string): Promise<FolderItem[]> {
  const rows = await db
    .select({
      id: folders.id,
      name: folders.name,
      source: folders.source,
      noteCount: sql<number>`count(${notes.id})::int`,
    })
    .from(folders)
    .leftJoin(
      noteFolders,
      and(eq(noteFolders.folderId, folders.id), eq(noteFolders.userId, userId))
    )
    .leftJoin(
      notes,
      and(
        eq(notes.id, noteFolders.noteId),
        eq(notes.userId, userId),
        ne(notes.status, "deleted"),
        isNull(notes.taskDate)
      )
    )
    .where(eq(folders.userId, userId))
    .groupBy(folders.id)
    .orderBy(asc(sql`lower(${folders.name})`));
  return rows;
}

export async function getOwnedFolder(userId: string, folderId: string) {
  const [row] = await db
    .select({ id: folders.id, name: folders.name, source: folders.source })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Põe a nota numa pasta — ou em "sem pasta", com `folderId` nulo — **pela
 * pessoa**. A procedência vira `user`, e a organização da IA não mexe mais
 * nesta nota. Quem chama já conferiu a posse da nota e da pasta.
 */
export async function placeNoteByUser(
  userId: string,
  noteId: string,
  folderId: string | null
): Promise<void> {
  await db
    .insert(noteFolders)
    .values({ noteId, userId, folderId, source: "user" })
    .onConflictDoUpdate({
      target: noteFolders.noteId,
      set: { folderId, source: "user", updatedAt: new Date() },
      setWhere: eq(noteFolders.userId, userId),
    });
}

/** Outra pasta desta pessoa já tem este nome (sem caixa nem acento)? */
export async function folderNameTaken(
  userId: string,
  name: string,
  exceptId: string | null = null
): Promise<{ taken: boolean; total: number }> {
  const rows = await db
    .select({ id: folders.id, name: folders.name })
    .from(folders)
    .where(eq(folders.userId, userId));
  return {
    taken: rows.some(
      (folder) => folder.id !== exceptId && folderKey(folder.name) === folderKey(name)
    ),
    total: rows.length,
  };
}
