import "server-only";

import { and, asc, count, desc, eq, ilike, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { attachments, notes } from "@/lib/db/schema";
import {
  ATTACHMENT_LIST_PAGE_SIZE,
  type AttachmentListOptions,
  type AttachmentListResult,
} from "@/lib/attachments/list";

/**
 * Inventário paginado dos arquivos da conta.
 *
 * A conexão do servidor pode passar por cima da RLS; por isso a posse entra
 * na própria consulta. O caminho privado do bucket fica deliberadamente fora
 * do select: abrir ou baixar continua sendo responsabilidade de
 * `GET /api/attachments/[id]`.
 */
export async function listOwnedAttachments(
  userId: string,
  options: AttachmentListOptions = {}
): Promise<AttachmentListResult> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(
    48,
    Math.max(1, options.pageSize ?? ATTACHMENT_LIST_PAGE_SIZE)
  );
  const query = options.query?.trim() ?? "";
  const conditions: SQL[] = [eq(attachments.userId, userId)];

  if (options.type && options.type !== "all") {
    conditions.push(eq(attachments.type, options.type));
  }
  if (query) {
    conditions.push(ilike(attachments.filename, `%${query}%`));
  }

  const where = and(...conditions)!;
  const orderBy =
    options.sort === "name"
      ? [asc(attachments.filename), desc(attachments.createdAt)]
      : options.sort === "size"
        ? [desc(attachments.sizeBytes), desc(attachments.createdAt)]
        : [desc(attachments.createdAt), desc(attachments.id)];

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: attachments.id,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        type: attachments.type,
        sizeBytes: attachments.sizeBytes,
        durationSeconds: attachments.durationSeconds,
        createdAt: attachments.createdAt,
        noteId: notes.id,
        noteTitle: notes.title,
      })
      .from(attachments)
      .leftJoin(
        notes,
        and(eq(attachments.noteId, notes.id), eq(notes.userId, userId))
      )
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(attachments).where(where),
  ]);

  const total = totalRow?.value ?? 0;
  return {
    attachments: rows.map(({ noteId, noteTitle, ...attachment }) => ({
      ...attachment,
      note: noteId && noteTitle ? { id: noteId, title: noteTitle } : null,
    })),
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };
}
