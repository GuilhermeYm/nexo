import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { getClientIp, logServerError } from "@/lib/api";

type AuditLogOptions = {
  action: string;
  tableName: string;
  recordId?: string;
  userId?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  request: Request;
};

/**
 * Registra uma ação sensível em audit_logs. Falha de auditoria NUNCA pode
 * quebrar a operação principal — por isso o try/catch interno apenas loga.
 * Nunca passar secrets, tokens ou senhas em oldData/newData.
 */
export async function writeAuditLog(options: AuditLogOptions): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: options.userId ?? null,
      action: options.action,
      tableName: options.tableName,
      recordId: options.recordId ?? null,
      oldData: options.oldData ?? null,
      newData: options.newData ?? null,
      ipAddress: getClientIp(options.request),
      userAgent: options.request.headers.get("user-agent") ?? "unknown",
    });
  } catch (error) {
    logServerError("writeAuditLog", error, {
      action: options.action,
      tableName: options.tableName,
    });
  }
}
