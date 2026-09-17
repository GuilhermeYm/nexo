import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  attachments,
  noteTags,
  notes,
  profiles,
  tags,
  workspaceConnections,
  workspaceWindows,
  workspaces,
} from "@/lib/db/schema";
import {
  toBoardBackground,
  type BoardBackground,
} from "@/lib/workspace/board-background";
import type { ConnectionStyle } from "@/lib/workspace/connection-style";

/**
 * Leituras da lousa.
 *
 * Mesmo arranjo do dashboard: as consultas vivem fora das rotas porque o
 * Server Component da página pinta o primeiro estado e as API routes
 * revalidam pelo mesmo caminho. Uma consulta só, duas portas.
 *
 * Toda função recebe `userId` já derivado de `auth.getUser()`. Nenhuma delas
 * aceita id vindo do cliente sem cruzar com o dono.
 */

export interface BoardWorkspace {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  isDefault: boolean;
  /** O fundo da lousa, já normalizado — ver `lib/workspace/board-background.ts`. */
  background: BoardBackground;
}

/**
 * O workspace, se ele for desta pessoa.
 *
 * Devolver `null` em vez de lançar é deliberado: quem chama transforma isso
 * num 404, e um id de outra pessoa fica indistinguível de um id que não
 * existe. Confirmar a existência já seria vazar informação.
 */
export async function getOwnedWorkspace(
  userId: string,
  workspaceId: string
): Promise<BoardWorkspace | null> {
  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      icon: workspaces.icon,
      color: workspaces.color,
      isDefault: workspaces.isDefault,
      boardPattern: workspaces.boardPattern,
      boardTone: workspaces.boardTone,
    })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)))
    .limit(1);

  if (!row) return null;

  const { boardPattern, boardTone, ...workspace } = row;
  return {
    ...workspace,
    // Normalizado aqui, uma vez: quem desenha a lousa nunca recebe um valor
    // que o `style` não saberia usar. Ver `toBoardBackground`.
    background: toBoardBackground(boardPattern, boardTone),
  };
}

export type WindowKind = "note" | "sticky" | "text" | "attachment";
export type WindowState = "normal" | "minimized" | "maximized";

/** Conteúdo dos elementos que não são nota. */
export interface WindowContent {
  text?: string;
  /** Posição na paleta de tags do tema, "1".."6". */
  tone?: string;
  /** Fundo da caixa de texto: sem preenchimento ou posição da paleta. */
  backgroundTone?: "none" | "1" | "2" | "3" | "4" | "5" | "6";
  /** Cor do texto: padrão da interface ou posição da paleta. */
  textTone?: "default" | "1" | "2" | "3" | "4" | "5" | "6";
  /**
   * Só a caixa de texto: sem borda nem fundo, fica só o texto sobre a lousa.
   * Ao editar, a moldura reaparece — ver `WindowFrame`.
   */
  borderless?: boolean;
}

/** Uma tag da nota, para a janela da lousa exibir com a cor da paleta. */
export interface BoardNoteTag {
  id: string;
  name: string;
  /** Posição na paleta (`tag-1`..`tag-6` do `globals.css`), ou `null`. */
  color: string | null;
}

/**
 * O arquivo por trás de uma janela de anexo.
 *
 * O `storage_path` **não** entra aqui. O cliente nunca precisa dele: quem
 * abre o arquivo é a rota de URL assinada, que resolve o caminho a partir do
 * id depois de conferir o dono. Mandar o caminho junto seria expor a
 * organização interna do bucket sem ganho nenhum.
 */
export interface BoardAttachment {
  id: string;
  filename: string;
  mimeType: string;
  /** `pdf` | `document` | `audio` | `image` | `video` | `other`. */
  type: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
}

export interface BoardWindow {
  id: string;
  kind: WindowKind;
  source: "user" | "ai";
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  state: WindowState;
  content: WindowContent | null;
  noteId: string | null;
  /** Preenchido quando `kind === "note"`. */
  note: {
    id: string;
    title: string;
    content: string | null;
    /**
     * O documento do editor. Nulo nas notas anteriores ao editor rico e nas
     * escritas pela IA — a janela monta o documento a partir do texto puro na
     * primeira abertura, e ele passa a existir no primeiro salvamento.
     */
    contentRich: unknown;
    type: string;
    /** Quem escreveu a nota — diferente de quem abriu a janela. */
    source: string;
    updatedAt: Date;
    /**
     * O arquivo que originou esta nota, se houver.
     *
     * É o que permite a janela de nota oferecer "abrir o arquivo": a nota
     * mostra o que a IA escreveu *sobre* o documento, e daqui se chega ao
     * documento em si.
     */
    attachmentId: string | null;
    /** As tags da nota, com a posição na paleta para colorir o chip. */
    tags: BoardNoteTag[];
  } | null;
  attachmentId: string | null;
  /** Preenchido quando `kind === "attachment"`. */
  attachment: BoardAttachment | null;
}

/**
 * Todas as janelas de uma lousa, com a nota de cada uma já embutida.
 *
 * A ordenação por `z_index` importa: o cliente pinta na ordem recebida e
 * confia no `z-index` do CSS para o resto. Recebendo já ordenado, o primeiro
 * paint do servidor tem o mesmo empilhamento do cliente.
 */
export async function listBoardWindows(
  userId: string,
  workspaceId: string
): Promise<BoardWindow[]> {
  const rows = await db
    .select({
      id: workspaceWindows.id,
      kind: workspaceWindows.kind,
      source: workspaceWindows.source,
      x: workspaceWindows.x,
      y: workspaceWindows.y,
      width: workspaceWindows.width,
      height: workspaceWindows.height,
      zIndex: workspaceWindows.zIndex,
      state: workspaceWindows.state,
      content: workspaceWindows.content,
      noteId: workspaceWindows.noteId,
      noteTitle: notes.title,
      noteContent: notes.content,
      noteContentRich: notes.contentRich,
      noteType: notes.type,
      noteSource: notes.source,
      noteUpdatedAt: notes.updatedAt,
      // Subconsulta e não um segundo `join` com `attachments`: uma nota pode
      // ter mais de um anexo, e o join multiplicaria a linha da janela.
      noteAttachmentId: sql<string | null>`(
        select a.id from ${attachments} a
        where a.note_id = ${notes.id} and a.user_id = ${userId}
        order by a.created_at
        limit 1
      )`,
      attachmentId: workspaceWindows.attachmentId,
      attachmentFilename: attachments.filename,
      attachmentMimeType: attachments.mimeType,
      attachmentType: attachments.type,
      attachmentSizeBytes: attachments.sizeBytes,
      attachmentDuration: attachments.durationSeconds,
    })
    .from(workspaceWindows)
    .leftJoin(notes, eq(workspaceWindows.noteId, notes.id))
    .leftJoin(attachments, eq(workspaceWindows.attachmentId, attachments.id))
    .where(
      and(
        eq(workspaceWindows.userId, userId),
        eq(workspaceWindows.workspaceId, workspaceId)
      )
    )
    .orderBy(asc(workspaceWindows.zIndex), asc(workspaceWindows.createdAt));

  // As tags numa segunda consulta, não num join: uma nota com cinco tags
  // multiplicaria a linha da janela por cinco. Mesmo padrão do `attachTags`
  // do dashboard.
  const tagsByNote = await loadNoteTags(
    rows.map((row) => row.noteId).filter((id): id is string => id !== null)
  );

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    source: row.source,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    zIndex: row.zIndex,
    state: row.state,
    content: (row.content as WindowContent | null) ?? null,
    noteId: row.noteId,
    // O LEFT JOIN torna todas as colunas da nota anuláveis para o
    // TypeScript, mesmo quando o CHECK do banco garante que uma janela de
    // nota sempre tem nota. A checagem abaixo é a que reconcilia as duas
    // verdades sem espalhar '!' pelo objeto.
    note: isJoinedNote(row)
      ? {
          id: row.noteId,
          title: row.noteTitle,
          content: row.noteContent,
          contentRich: row.noteContentRich ?? null,
          type: row.noteType,
          source: row.noteSource,
          updatedAt: row.noteUpdatedAt,
          attachmentId: row.noteAttachmentId,
          tags: tagsByNote.get(row.noteId) ?? [],
        }
      : null,
    attachmentId: row.attachmentId,
    attachment:
      row.attachmentId && row.attachmentFilename !== null
        ? {
            id: row.attachmentId,
            filename: row.attachmentFilename,
            mimeType: row.attachmentMimeType!,
            type: row.attachmentType!,
            sizeBytes: row.attachmentSizeBytes,
            durationSeconds: row.attachmentDuration,
          }
        : null,
  }));
}

/**
 * As tags de um conjunto de notas, agrupadas por nota. Usada pela janela de
 * nota da lousa e pela lista de "Trazer da conta".
 *
 * `inArray` e não um `= any()` montado à mão: o Drizzle serializa a lista
 * como `uuid[]` em vez de deixar o driver adivinhar. Ordenadas por nome para
 * o chip não trocar de lugar entre um retrato e o seguinte.
 */
async function loadNoteTags(
  noteIds: string[]
): Promise<Map<string, BoardNoteTag[]>> {
  const byNote = new Map<string, BoardNoteTag[]>();
  if (noteIds.length === 0) return byNote;

  const rows = await db
    .select({
      noteId: noteTags.noteId,
      id: tags.id,
      name: tags.name,
      color: tags.color,
    })
    .from(noteTags)
    .innerJoin(tags, eq(noteTags.tagId, tags.id))
    .where(inArray(noteTags.noteId, noteIds))
    .orderBy(asc(tags.name));

  for (const row of rows) {
    const list = byNote.get(row.noteId) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    byNote.set(row.noteId, list);
  }

  return byNote;
}

/**
 * Uma flecha entre dois elementos da lousa.
 *
 * Só os três ids. Onde a flecha começa e termina na tela é geometria, e
 * geometria se calcula a partir das janelas que já estão no retrato —
 * guardar pontos aqui seria uma segunda cópia da posição, que ficaria velha
 * no primeiro arraste.
 */
export interface BoardConnection extends ConnectionStyle {
  id: string;
  fromWindowId: string;
  toWindowId: string;
  /** O que a flecha diz. Nulo quando ninguém escreveu nada nela. */
  label: string | null;
}

/**
 * O que uma ligação carrega além das pontas, pronto para `select` e
 * `returning`. Um objeto só para a leitura, a borracha e o cascade das
 * janelas: um campo novo esquecido num deles voltaria sem ele no "Desfazer".
 */
export const connectionContentColumns = {
  label: workspaceConnections.label,
  tone: workspaceConnections.tone,
  stroke: workspaceConnections.stroke,
  weight: workspaceConnections.weight,
  heads: workspaceConnections.heads,
};

/**
 * As ligações de uma lousa.
 *
 * Lida junto com as janelas, na mesma requisição: as duas mudam juntas (uma
 * janela fechada leva as flechas dela por cascade) e dois retratos tirados em
 * momentos diferentes desenhariam flecha para janela que não existe mais.
 */
export async function listBoardConnections(
  userId: string,
  workspaceId: string
): Promise<BoardConnection[]> {
  return db
    .select({
      id: workspaceConnections.id,
      fromWindowId: workspaceConnections.fromWindowId,
      toWindowId: workspaceConnections.toWindowId,
      ...connectionContentColumns,
    })
    .from(workspaceConnections)
    .where(
      and(
        eq(workspaceConnections.userId, userId),
        eq(workspaceConnections.workspaceId, workspaceId)
      )
    )
    .orderBy(asc(workspaceConnections.createdAt));
}

/**
 * O retrato inteiro da lousa: as janelas e as ligações entre elas.
 *
 * Uma função só porque quem lê uma sempre lê a outra. As duas consultas vão
 * em paralelo — elas não dependem uma da outra.
 */
export async function readBoard(
  userId: string,
  workspaceId: string
): Promise<{ windows: BoardWindow[]; connections: BoardConnection[] }> {
  const [windows, connections] = await Promise.all([
    listBoardWindows(userId, workspaceId),
    listBoardConnections(userId, workspaceId),
  ]);

  return { windows, connections };
}

export interface OpenableNote {
  id: string;
  title: string;
  excerpt: string | null;
  type: string;
  source: string;
  updatedAt: Date;
  /** As tags da nota — a lista de "Trazer da conta" as mostra coloridas. */
  tags: BoardNoteTag[];
}

/**
 * As notas que a pessoa ainda pode trazer para esta lousa.
 *
 * Vem do sistema inteiro, não só deste workspace: o produto promete que a
 * pessoa consegue "pegar tudo do sistema dela e abrir nesse espaço". Uma nota
 * já aberta aqui sai da lista — o índice único em `(workspace_id, note_id)`
 * recusaria a segunda janela de qualquer forma, e oferecer o que vai falhar
 * é pior do que não oferecer.
 */
export async function listOpenableNotes(
  userId: string,
  workspaceId: string,
  query?: string,
  limit = 40
): Promise<OpenableNote[]> {
  // Subconsulta em vez de duas idas ao banco: as notas já na lousa saem no
  // mesmo plano de execução.
  const alreadyOpen = db
    .select({ noteId: workspaceWindows.noteId })
    .from(workspaceWindows)
    .where(
      and(
        eq(workspaceWindows.userId, userId),
        eq(workspaceWindows.workspaceId, workspaceId),
        sql`${workspaceWindows.noteId} is not null`
      )
    );

  const trimmed = query?.trim();
  const conditions = [
    eq(notes.userId, userId),
    ne(notes.status, "deleted"),
    notInArray(notes.id, alreadyOpen),
  ];

  if (trimmed) {
    const tsQuery = sql`websearch_to_tsquery('portuguese', ${trimmed})`;
    conditions.push(
      or(
        sql`${notes.searchVector} @@ ${tsQuery}`,
        sql`${notes.title} ilike ${`%${trimmed}%`}`
      )!
    );
  }

  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      type: notes.type,
      source: notes.source,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(and(...conditions))
    .orderBy(desc(notes.updatedAt))
    .limit(limit);

  const tagsByNote = await loadNoteTags(rows.map((row) => row.id));

  return rows.map(({ content, ...row }) => ({
    ...row,
    excerpt: buildExcerpt(content),
    tags: tagsByNote.get(row.id) ?? [],
  }));
}

/** Quantas janelas esta lousa já tem — para conferir contra o teto do plano. */
export async function countBoardWindows(
  userId: string,
  workspaceId: string
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(workspaceWindows)
    .where(
      and(
        eq(workspaceWindows.userId, userId),
        eq(workspaceWindows.workspaceId, workspaceId)
      )
    );

  return row?.total ?? 0;
}

/** O plano da pessoa, para as rotas resolverem os limites. */
export async function getUserPlan(userId: string): Promise<string> {
  const [row] = await db
    .select({ plan: profiles.plan })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  return row?.plan ?? "free";
}

type JoinedRow = {
  noteId: string | null;
  noteTitle: string | null;
  noteType: string | null;
  noteSource: string | null;
  noteUpdatedAt: Date | null;
};

function isJoinedNote<T extends JoinedRow>(
  row: T
): row is T & {
  noteId: string;
  noteTitle: string;
  noteType: string;
  noteSource: string;
  noteUpdatedAt: Date;
} {
  return (
    row.noteId !== null &&
    row.noteTitle !== null &&
    row.noteType !== null &&
    row.noteSource !== null &&
    row.noteUpdatedAt !== null
  );
}

/** Primeira linha útil do conteúdo, cortada em limite de palavra. */
function buildExcerpt(content: string | null): string | null {
  if (!content) return null;

  const flat = content.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= 120) return flat;

  const cut = flat.slice(0, 120);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 80 ? lastSpace : 120)}…`;
}

export interface BoardWriteContext {
  plan: string;
  windowCount: number;
  /** Próximo `z_index` livre nesta lousa. */
  nextZ: number;
  /** Onde pôr uma janela quando quem cria não informou posição. */
  nextX: number;
  nextY: number;
}

/**
 * Tudo o que a criação de uma janela precisa saber, numa consulta só.
 *
 * Antes isto eram quatro idas ao banco em sequência — dono do workspace,
 * plano, contagem para o teto e topo da pilha. Some com o `getUser()` da
 * rota e a criação levava mais de um segundo, tempo suficiente para a pessoa
 * clicar em "Nova nota" e começar a digitar antes de a janela existir.
 *
 * Devolve `null` quando o workspace não é desta pessoa — o `join` com
 * `workspaces` filtrado por `user_id` é a própria verificação de dono.
 */
export async function getBoardWriteContext(
  userId: string,
  workspaceId: string
): Promise<BoardWriteContext | null> {
  const [row] = await db
    .select({
      plan: profiles.plan,
      windowCount: sql<number>`(
        select count(*)::int from workspace_windows ww
        where ww.workspace_id = ${workspaces.id} and ww.user_id = ${userId}
      )`,
      nextZ: sql<number>`(
        select coalesce(max(ww.z_index), 0) + 1 from workspace_windows ww
        where ww.workspace_id = ${workspaces.id} and ww.user_id = ${userId}
      )`,
      // Alinhada à esquerda do que já existe e logo abaixo de tudo: a janela
      // nova entra na margem do arranjo em vez de cair por cima dele.
      nextX: sql<number>`(
        select coalesce(min(ww.x), 0) from workspace_windows ww
        where ww.workspace_id = ${workspaces.id} and ww.user_id = ${userId}
      )`,
      nextY: sql<number>`(
        select coalesce(max(ww.y + ww.height) + 24, 0) from workspace_windows ww
        where ww.workspace_id = ${workspaces.id} and ww.user_id = ${userId}
      )`,
    })
    .from(workspaces)
    .innerJoin(profiles, eq(profiles.id, workspaces.userId))
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)))
    .limit(1);

  return row ? { ...row, plan: row.plan ?? "free" } : null;
}

export interface OpenableAttachment {
  id: string;
  filename: string;
  mimeType: string;
  type: string;
  sizeBytes: number | null;
  /** Título da nota que a IA escreveu sobre o arquivo, quando existe. */
  noteTitle: string | null;
  createdAt: Date;
}

/**
 * Os arquivos que a pessoa ainda pode trazer para esta lousa.
 *
 * Mesma regra da lista de notas: o que já está aberto aqui sai da lista, e o
 * índice único recusaria a segunda janela de qualquer forma. Oferecer o que
 * vai falhar é pior do que não oferecer.
 */
export async function listOpenableAttachments(
  userId: string,
  workspaceId: string,
  query?: string,
  limit = 40
): Promise<OpenableAttachment[]> {
  const alreadyOpen = db
    .select({ attachmentId: workspaceWindows.attachmentId })
    .from(workspaceWindows)
    .where(
      and(
        eq(workspaceWindows.userId, userId),
        eq(workspaceWindows.workspaceId, workspaceId),
        sql`${workspaceWindows.attachmentId} is not null`
      )
    );

  const trimmed = query?.trim();
  const conditions = [
    eq(attachments.userId, userId),
    notInArray(attachments.id, alreadyOpen),
  ];

  if (trimmed) {
    conditions.push(
      or(
        sql`${attachments.filename} ilike ${`%${trimmed}%`}`,
        sql`${notes.title} ilike ${`%${trimmed}%`}`
      )!
    );
  }

  return db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      type: attachments.type,
      sizeBytes: attachments.sizeBytes,
      noteTitle: notes.title,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .leftJoin(notes, eq(attachments.noteId, notes.id))
    .where(and(...conditions))
    .orderBy(desc(attachments.createdAt))
    .limit(limit);
}
