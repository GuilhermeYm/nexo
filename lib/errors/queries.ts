import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { errorReports } from "@/lib/db/schema";
import type { ErrorReportKind } from "@/lib/errors/report";

/**
 * Leitura de `error_reports` pelo dono.
 *
 * **A lista de colunas abaixo é a mesma do `GRANT SELECT` de 0015, e isso não
 * é coincidência.** São duas travas para a mesma regra: `message`, `stack`,
 * `context` e `fingerprint` não chegam ao cliente nem por esta rota (que
 * entra pela `DATABASE_URL` e enxergaria tudo) nem pelo PostgREST (que não
 * enxerga). Cada uma cobre o furo da outra: o GRANT não alcança este `select`,
 * e este `select` não alcança quem chegar pela chave anônima.
 *
 * O que sobra é o suficiente para a pessoa fechar o ciclo: o código para
 * ditar, quando aconteceu, quantas vezes, se ela já reportou e se alguém já
 * resolveu. O que o erro **diz** é diagnóstico interno — e mostrar stack
 * trace para o usuário é o item 8 da tabela de problemas comuns do
 * `AGENTS.md`.
 */

export interface OwnErrorReport {
  code: string;
  route: string;
  kind: ErrorReportKind;
  userReport: string | null;
  userReportedAt: string | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

/** Teto da lista. Quem tem mais de 50 erros tem um problema maior que a aba. */
const LIST_LIMIT = 50;

export async function listOwnErrorReports(
  userId: string
): Promise<OwnErrorReport[]> {
  const rows = await db
    .select({
      code: errorReports.code,
      route: errorReports.route,
      kind: errorReports.kind,
      userReport: errorReports.userReport,
      userReportedAt: errorReports.userReportedAt,
      occurrences: errorReports.occurrences,
      firstSeenAt: errorReports.firstSeenAt,
      lastSeenAt: errorReports.lastSeenAt,
      resolvedAt: errorReports.resolvedAt,
    })
    .from(errorReports)
    .where(eq(errorReports.userId, userId))
    .orderBy(desc(errorReports.lastSeenAt))
    .limit(LIST_LIMIT);

  // Date não atravessa a fronteira Server → Client; ISO atravessa.
  return rows.map((row) => ({
    ...row,
    userReportedAt: row.userReportedAt?.toISOString() ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  }));
}

/**
 * Anexa o relato da pessoa a um erro que é dela.
 *
 * O filtro por `user_id` é o que torna o código não-adivinhável irrelevante:
 * mesmo que alguém acerte um `NX-…` de outra conta, o `UPDATE` alcança zero
 * linhas. E a rota responde a mesma coisa nos dois casos — código inexistente
 * e código de outro dono —, para não virar oráculo de "este código existe".
 *
 * `user_report` e `user_reported_at` são as **únicas** colunas que esta
 * função escreve. Não é zelo: sem isso, o mesmo caminho que existe para a
 * pessoa contar o que aconteceu serviria para reescrever o que o servidor
 * registrou, e a tabela deixaria de valer como registro.
 */
export async function attachUserReport(
  userId: string,
  code: string,
  report: string
): Promise<boolean> {
  const updated = await db
    .update(errorReports)
    .set({ userReport: report, userReportedAt: new Date() })
    .where(and(eq(errorReports.code, code), eq(errorReports.userId, userId)))
    .returning({ code: errorReports.code });

  return updated.length > 0;
}
