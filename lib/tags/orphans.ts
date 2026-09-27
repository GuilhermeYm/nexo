import "server-only";

import { createHash } from "node:crypto";

import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";

import { logServerError } from "@/lib/api";
import { db } from "@/lib/db";
import { noteTags, notes, notifications, tags } from "@/lib/db/schema";
import { notifySystem } from "@/lib/inbox/notify";

/**
 * Tags sem notas — as que nenhuma nota viva usa mais.
 *
 * Elas nascem sozinhas: a IA cria tags ao classificar, a pessoa tira a tag da
 * última nota que a usava, uma nota é apagada. Uma tag assim não leva a nada
 * — abrir mostra "Nenhuma nota com esta tag" — e, na lista de recentes, ela
 * ocupava o lugar de uma que leva. Por isso a página de Tags e o grafo as
 * deixam de fora por padrão (a busca continua achando), e a Nexo avisa na
 * Entrada quando elas se acumulam, com o link para revisar.
 *
 * **"Viva" é tudo que não foi apagado** — a mesma régua da contagem de notas
 * da página (`listTagsWithUsage`). Nota arquivada continua contando: a tag
 * dela ainda organiza alguma coisa.
 *
 * **Ninguém apaga sozinho.** O aviso sugere; quem decide é a pessoa. Uma tag
 * sem notas hoje pode ser a que ela acabou de criar para a nota de amanhã.
 */

/** A condição "nenhuma nota viva usa esta tag", reaproveitada na leitura e na escrita. */
function hasNoLiveNotes() {
  return sql`not exists (
    select 1 from ${noteTags}
    inner join ${notes} on ${notes.id} = ${noteTags.noteId}
    where ${noteTags.tagId} = ${tags.id} and ${notes.status} <> 'deleted'
  )`;
}

export interface OrphanTag {
  id: string;
  name: string;
}

/**
 * As tags sem notas de uma pessoa, das mais antigas para as mais novas.
 *
 * `minAgeMs` deixa de fora as recém-criadas: trocar a tag de uma nota por
 * outra (tirar e pôr) passa um instante sem nota nenhuma, e isso não é motivo
 * para aviso.
 */
export async function listOrphanTags(
  userId: string,
  { minAgeMs = 0 }: { minAgeMs?: number } = {}
): Promise<OrphanTag[]> {
  return db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(
      and(
        eq(tags.userId, userId),
        minAgeMs > 0
          ? lt(tags.createdAt, new Date(Date.now() - minAgeMs))
          : undefined,
        hasNoLiveNotes()
      )
    )
    .orderBy(asc(tags.createdAt));
}

/**
 * Apaga, dentre os ids pedidos, só as tags que **continuam** sem notas.
 *
 * O cliente manda o que ele viu na tela; o servidor confere de novo na mesma
 * instrução. Se uma delas ganhou nota entre a tela e o clique (outra aba, a
 * IA classificando), ela fica — apagar a tag agora tiraria ela de uma nota
 * que a pessoa não viu na lista. Devolve as que saíram, com o nome, para a
 * auditoria e para a tela dizer quantas foram.
 */
export async function deleteOrphanTags(
  userId: string,
  tagIds: string[]
): Promise<OrphanTag[]> {
  if (tagIds.length === 0) return [];

  return db
    .delete(tags)
    .where(
      and(eq(tags.userId, userId), inArray(tags.id, tagIds), hasNoLiveNotes())
    )
    .returning({ id: tags.id, name: tags.name });
}

/** Sem aviso para tag criada há menos de um dia: pode estar a caminho de uma nota. */
const NOTICE_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Quantos nomes o corpo do aviso cita antes do "e mais N". */
const NOTICE_NAMED = 3;

/**
 * Avisa na Entrada quando há tags sem notas — no máximo **um aviso não lido**
 * de cada vez.
 *
 * Roda em `after()` nas cargas do dashboard e da página de Tags, então precisa
 * ser barato e calado:
 *
 * - com um aviso de tags sem notas ainda não lido, não escreve outro — a
 *   pessoa já sabe, e empilhar "3 tags", "4 tags", "5 tags" na Entrada seria
 *   ruído;
 * - o `dedupeKey` é o **conjunto** de tags: o mesmo conjunto não avisa duas
 *   vezes nem depois de lido. Só um conjunto diferente (uma tag nova ficou
 *   sem notas) gera outro aviso.
 *
 * Não lança: é trabalho de fundo, e o aviso é sobre o estado, não o estado.
 */
export async function notifyOrphanTags(userId: string): Promise<void> {
  try {
    const orphans = await listOrphanTags(userId, {
      minAgeMs: NOTICE_MIN_AGE_MS,
    });
    if (orphans.length === 0) return;

    const [pending] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.read, false),
          sql`${notifications.metadata} ->> 'kind' = 'orphan-tags'`
        )
      )
      .limit(1);
    if (pending) return;

    const fingerprint = createHash("sha256")
      .update(
        orphans
          .map((tag) => tag.id)
          .sort()
          .join(",")
      )
      .digest("hex")
      .slice(0, 16);

    const count = orphans.length;
    // "#a e #b", "#a, #b e #c", "#a, #b, #c e mais 4".
    const shown = orphans.slice(0, NOTICE_NAMED).map((tag) => `#${tag.name}`);
    const rest = count - shown.length;
    const named =
      rest > 0
        ? `${shown.join(", ")} e mais ${rest}`
        : new Intl.ListFormat("pt-BR", { type: "conjunction" }).format(shown);

    await notifySystem({
      userId,
      title:
        count === 1
          ? "Uma tag ficou sem notas"
          : `${count} tags ficaram sem notas`,
      body: `${named} não ${
        count === 1 ? "marca" : "marcam"
      } mais nenhuma nota. ${
        count === 1 ? "Ela saiu" : "Elas saíram"
      } da lista de Tags e do grafo, mas continuam na busca — revise e apague o que não faz mais falta.`,
      metadata: {
        kind: "orphan-tags",
        dedupeKey: `orphan-tags:${fingerprint}`,
        href: "/dashboard/tags?modo=sem-notas",
        count,
      },
    });
  } catch (error) {
    // Sem aviso desta vez; a próxima carga tenta de novo.
    logServerError("notifyOrphanTags", error, { userId });
  }
}
