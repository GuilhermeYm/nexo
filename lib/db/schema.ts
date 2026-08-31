import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  bigint,
  integer,
  date,
  jsonb,
  primaryKey,
  pgEnum,
  index,
  uniqueIndex,
  unique,
  foreignKey,
  check,
  customType,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// drizzle-orm não tem tipo nativo tsvector nesta versão — definimos via customType.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "unpaid",
  "paused",
]);

export const planEnum = pgEnum("plan", ["free", "pro", "enterprise"]);

export const noteTypeEnum = pgEnum("note_type", [
  "note",
  "task",
  "journal",
  "idea",
  "meeting",
  "document",
]);

export const noteSourceEnum = pgEnum("note_source", ["user", "ai"]);

export const noteStatusEnum = pgEnum("note_status", [
  "active",
  "archived",
  "deleted",
]);

export const attachmentTypeEnum = pgEnum("attachment_type", [
  "image",
  "audio",
  "video",
  "pdf",
  "document",
  "other",
]);

/**
 * Perfil do usuário vinculado ao auth.users do Supabase.
 * Guarda dados de assinatura (Stripe) e preferências.
 */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    subscriptionStatus: subscriptionStatusEnum("subscription_status").default("trialing"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    plan: planEnum("plan").default("free").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    stripeCustomerIdx: uniqueIndex("profiles_stripe_customer_id_idx").on(
      table.stripeCustomerId
    ),
  })
);

/**
 * Workspaces são os espaços de trabalho do usuário.
 * No futuro sustentarão a experiência tipo Notion/Obsidian.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    color: text("color"),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("workspaces_user_id_idx").on(table.userId),
    // Alvo da chave estrangeira composta de workspace_windows. Com ela, uma
    // janela não consegue apontar para o workspace de outra pessoa nem por
    // bug de aplicação: o banco recusa a linha.
    idUserKey: unique("workspaces_id_user_id_key").on(table.id, table.userId),
  })
);

/**
 * Notas / blocos de conteúdo do usuário.
 * Podem ser criadas pelo usuário ou pela IA (source).
 * Suportam hierarquia via parent_id para futuro sistema de links/blocos.
 */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id"),
    parentId: uuid("parent_id"),
    title: text("title").notNull(),
    /**
     * Projeção em texto puro — é o que alimenta `search_vector` e os
     * resumos. Derivada de `contentRich` pelo servidor quando o editor
     * salva; escrita direto quando a origem é um textarea ou a IA.
     */
    content: text("content"),
    /** Documento do editor (TipTap/ProseMirror). Ver drizzle/0008. */
    contentRich: jsonb("content_rich"),
    type: noteTypeEnum("type").default("note").notNull(),
    source: noteSourceEnum("source").default("user").notNull(),
    status: noteStatusEnum("status").default("active").notNull(),
    metadata: jsonb("metadata"),
    /**
     * O dia desta lista de tarefas, no fuso de **quem escreveu**. Ver
     * drizzle/0016 e docs/AGENDA.md.
     *
     * Nulo em toda nota que não é da Agenda — inclusive nas `type = 'task'`
     * que a IA cria ao classificar um upload. Por isso o discriminador da
     * Agenda é esta coluna, e nunca `type` sozinho.
     */
    taskDate: date("task_date"),
    /**
     * Quantas caixas o documento tem, e quantas estão marcadas.
     *
     * Derivadas de `contentRich` pelo servidor a cada escrita, no mesmo lugar
     * e pelo mesmo motivo que `content` já é derivado: o cliente não pode ser
     * a fonte da verdade sobre o que ele mesmo mandou. Existem para a Agenda
     * listar trinta dias com "5 de 7" sem baixar o documento de nenhum.
     */
    tasksTotal: integer("tasks_total").default(0).notNull(),
    tasksDone: integer("tasks_done").default(0).notNull(),
    // Busca full-text em português (coluna gerada no banco — ver drizzle/0003).
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(content, ''))`
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("notes_user_id_idx").on(table.userId),
    workspaceIdx: index("notes_workspace_id_idx").on(table.workspaceId),
    parentIdx: index("notes_parent_id_idx").on(table.parentId),
    statusIdx: index("notes_status_idx").on(table.status),
    // Mesmo papel do índice equivalente em workspaces: alvo da FK composta.
    idUserKey: unique("notes_id_user_id_key").on(table.id, table.userId),
    /**
     * Uma lista da Agenda por dia, por pessoa — a invariante mora aqui, no
     * banco, e não numa checagem da aplicação. Ver drizzle/0016.
     *
     * O predicado tem três partes e nenhuma é decorativa: `task_date` não
     * nulo porque a IA cria `type = 'task'` sem data ao classificar upload
     * (essas não podem colidir entre si), e `status <> 'deleted'` porque
     * apagar a lista de um dia precisa liberar o dia.
     *
     * Quem usa `onConflictDoNothing` contra este índice tem de repetir o
     * predicado inteiro no `where`, senão o Postgres levanta 42P10 em toda
     * requisição — não só nas concorrentes.
     */
    taskDateKey: uniqueIndex("notes_user_task_date_key")
      .on(table.userId, table.taskDate)
      .where(
        sql`${table.type} = 'task' and ${table.taskDate} is not null and ${table.status} <> 'deleted'`
      ),
  })
);

/**
 * Tags criadas pelo usuário para organizar notas e workspaces.
 */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("tags_user_id_idx").on(table.userId),
    userNameIdx: uniqueIndex("tags_user_id_name_idx").on(table.userId, table.name),
  })
);

/**
 * Relação N:N entre notas e tags.
 */
export const noteTags = pgTable(
  "note_tags",
  {
    noteId: uuid("note_id").notNull(),
    tagId: uuid("tag_id").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.noteId, table.tagId] }),
    noteIdx: index("note_tags_note_id_idx").on(table.noteId),
    tagIdx: index("note_tags_tag_id_idx").on(table.tagId),
  })
);

/**
 * Anexos (imagens, áudio, PDFs, etc.) vinculados a notas.
 * Os arquivos em si ficam no Supabase Storage; aqui guardamos metadados.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id").notNull(),
    noteId: uuid("note_id"),
    type: attachmentTypeEnum("type").default("other").notNull(),
    storagePath: text("storage_path").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    durationSeconds: integer("duration_seconds"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("attachments_user_id_idx").on(table.userId),
    noteIdx: index("attachments_note_id_idx").on(table.noteId),
    // Alvo da FK composta de workspace_windows — mesmo papel dos índices
    // equivalentes em workspaces e notes.
    idUserKey: unique("attachments_id_user_id_key").on(table.id, table.userId),
  })
);

/**
 * Logs de auditoria para ações sensíveis (UPDATE/DELETE).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    tableName: text("table_name").notNull(),
    // Nullable desde drizzle/0005: eventos sem registro associado
    // (ex.: tentativa de login falha) não têm record_id.
    recordId: uuid("record_id"),
    oldData: jsonb("old_data"),
    newData: jsonb("new_data"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("audit_logs_user_id_idx").on(table.userId),
    recordIdx: index("audit_logs_record_id_idx").on(table.recordId),
    createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt),
  })
);

/* Relations */

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  notes: many(notes),
}));

export const notesRelations = relations(notes, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [notes.workspaceId],
    references: [workspaces.id],
  }),
  parent: one(notes, {
    fields: [notes.parentId],
    references: [notes.id],
  }),
  tags: many(noteTags),
  attachments: many(attachments),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  notes: many(noteTags),
}));

export const noteTagsRelations = relations(noteTags, ({ one }) => ({
  note: one(notes, {
    fields: [noteTags.noteId],
    references: [notes.id],
  }),
  tag: one(tags, {
    fields: [noteTags.tagId],
    references: [tags.id],
  }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  note: one(notes, {
    fields: [attachments.noteId],
    references: [notes.id],
  }),
}));

/* -------------------------------------------------------------------------
 * Tarefas dos agentes de IA
 * ---------------------------------------------------------------------- */

/**
 * O que o agente fez (ou tentaria fazer) com uma captura.
 * Cada valor vira uma linha legível no feed de Tarefas do dashboard.
 */
export const aiJobKindEnum = pgEnum("ai_job_kind", [
  "classify", // decidir o tipo da captura
  "summarize", // escrever o resumo
  "tag", // criar/atribuir tags
  "transcribe", // áudio -> texto
  "extract", // PDF/imagem -> texto
  "organize", // escolher/criar o workspace
]);

/**
 * Estados possíveis de uma tarefa.
 *
 * `insufficient_credits` é um estado terminal-mas-retomável: o trabalho não
 * foi feito por falta de crédito, e a linha precisa sobreviver a qualquer
 * limpeza de cache para o usuário poder retomá-la depois de assinar. É a
 * razão de este feed morar no Postgres e não só em cache.
 */
export const aiJobStatusEnum = pgEnum("ai_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "insufficient_credits",
]);

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id").notNull(),
    // Onde o trabalho aconteceu. Ambos opcionais: uma captura pode ser
    // classificada antes de ter workspace, e uma tarefa pode falhar antes de
    // existir nota alguma.
    workspaceId: uuid("workspace_id"),
    noteId: uuid("note_id"),
    kind: aiJobKindEnum("kind").notNull(),
    status: aiJobStatusEnum("status").default("queued").notNull(),
    /** Uma linha em pt-BR, pronta para exibição: "Classificou contrato.pdf". */
    label: text("label").notNull(),
    /** Segunda linha opcional: o que saiu, ou por que não saiu. */
    detail: text("detail"),
    /** O que a tarefa produziu (tags criadas, tipo escolhido, resumo). */
    result: jsonb("result"),
    /**
     * Por que a tarefa falhou, em texto.
     *
     * **Atenção ao alcance.** Desde 0005 `ai_jobs` é SELECT-only para o dono,
     * então esta coluna é legível pelo cliente via PostgREST — ao contrário
     * de `error_reports.message`, que tem GRANT por coluna. Quem escreve aqui
     * passa o texto por `redactAndTrim` (`lib/errors/redact.ts`) antes: corpo
     * de erro de provedor às vezes ecoa a chave que recebeu.
     */
    error: text("error"),
    /**
     * O código de `error_reports` que explica a falha, quando houve uma.
     *
     * Texto solto e não chave estrangeira, de propósito: a retenção de
     * `error_reports` apaga relatórios antigos, e um `ON DELETE SET NULL`
     * limparia justamente o código que esta linha do feed já mostrou para a
     * pessoa. O job guarda o que ele exibiu; se o relatório expirou, o
     * suporte responde que expirou — e não que nunca existiu.
     */
    errorCode: text("error_code"),
    /** Custo em créditos, para a retomada saber o que cobrar. */
    creditsCost: integer("credits_cost").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdx: index("ai_jobs_user_id_idx").on(table.userId),
    statusIdx: index("ai_jobs_status_idx").on(table.status),
    // O feed lê sempre as mais recentes do usuário: índice composto.
    userRecentIdx: index("ai_jobs_user_created_at_idx").on(
      table.userId,
      table.createdAt
    ),
    noteIdx: index("ai_jobs_note_id_idx").on(table.noteId),
  })
);

export const aiJobsRelations = relations(aiJobs, ({ one }) => ({
  note: one(notes, {
    fields: [aiJobs.noteId],
    references: [notes.id],
  }),
  workspace: one(workspaces, {
    fields: [aiJobs.workspaceId],
    references: [workspaces.id],
  }),
}));

/* -------------------------------------------------------------------------
 * A lousa: janelas de um workspace
 * ---------------------------------------------------------------------- */

/**
 * O que uma janela mostra.
 *
 * `note` aponta para uma linha em `notes` — o conteúdo continua achável pela
 * busca e pelas tags mesmo estando na lousa, que é o princípio nº 3 do
 * produto. `sticky` e `text` são elementos que existem só na lousa e guardam
 * o próprio conteúdo em `content`.
 */
export const workspaceWindowKindEnum = pgEnum("workspace_window_kind", [
  "note",
  "sticky",
  "text",
  // O arquivo em si — o PDF, o áudio —, não a nota que a IA escreveu sobre
  // ele. Aponta para `attachments` e não para a nota, então um anexo pode
  // ser aberto sozinho.
  "attachment",
]);

export const workspaceWindowStateEnum = pgEnum("workspace_window_state", [
  "normal",
  "minimized",
  "maximized",
]);

/**
 * Uma janela na lousa de um workspace.
 *
 * O layout mora aqui e não no `localStorage` porque é trabalho da pessoa, e
 * trabalho precisa atravessar dispositivos. O que é de dispositivo — para
 * onde esta tela está olhando, ou seja pan e zoom — esse sim fica no storage
 * local (ver `hooks/use-board-viewport.ts`).
 *
 * Durante o arraste nada disto é escrito: o React conduz o movimento a 60fps
 * e a persistência acontece uma vez, depois que a pessoa solta.
 *
 * **Isolamento.** A RLS garante que a linha pertence a quem consulta, mas
 * sozinha ela não impediria alguém de gravar uma janela sua apontando para o
 * workspace de outra pessoa. Quem impede são as duas chaves estrangeiras
 * compostas abaixo: `(workspace_id, user_id)` e `(note_id, user_id)` só
 * fecham se as duas pontas forem do mesmo dono. Como o Postgres usa MATCH
 * SIMPLE, a segunda simplesmente não é verificada quando `note_id` é nulo —
 * que é o caso dos elementos próprios da lousa.
 */
export const workspaceWindows = pgTable(
  "workspace_windows",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    /** Preenchido só quando `kind = 'note'`. */
    noteId: uuid("note_id"),
    /** Preenchido só quando `kind = 'attachment'`. */
    attachmentId: uuid("attachment_id"),
    kind: workspaceWindowKindEnum("kind").default("note").notNull(),
    /**
     * Quem pôs esta janela aqui. Reaproveita o enum de `notes.source` porque
     * a pergunta é a mesma, e a resposta precisa continuar visível: autoria
     * da IA nunca é apagada (princípio nº 4).
     */
    source: noteSourceEnum("source").default("user").notNull(),
    /** Conteúdo dos elementos que não são nota: `{ text, tone }`. */
    content: jsonb("content"),
    x: integer("x").default(0).notNull(),
    y: integer("y").default(0).notNull(),
    width: integer("width").default(320).notNull(),
    height: integer("height").default(220).notNull(),
    zIndex: integer("z_index").default(0).notNull(),
    state: workspaceWindowStateEnum("state").default("normal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // A lousa lê sempre todas as janelas de um workspace.
    workspaceIdx: index("workspace_windows_workspace_id_idx").on(
      table.workspaceId
    ),
    userIdx: index("workspace_windows_user_id_idx").on(table.userId),
    noteIdx: index("workspace_windows_note_id_idx").on(table.noteId),
    attachmentIdx: index("workspace_windows_attachment_id_idx").on(
      table.attachmentId
    ),
    // A mesma nota — e o mesmo arquivo — não abrem duas vezes na mesma
    // lousa. Nulos não colidem entre si no Postgres, então as janelas que não
    // são daquele tipo passam à vontade.
    oncePerBoard: uniqueIndex("workspace_windows_workspace_note_idx").on(
      table.workspaceId,
      table.noteId
    ),
    attachmentOncePerBoard: uniqueIndex(
      "workspace_windows_workspace_attachment_idx"
    ).on(table.workspaceId, table.attachmentId),

    // Alvo das chaves estrangeiras de tres colunas de workspace_connections:
    // uma ligacao so fecha se as duas pontas forem da mesma pessoa E da
    // mesma lousa.
    boardScopeKey: unique("workspace_windows_id_workspace_id_user_id_key").on(
      table.id,
      table.workspaceId,
      table.userId
    ),

    workspaceFk: foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaces.id, workspaces.userId],
      name: "workspace_windows_workspace_fk",
    }).onDelete("cascade"),

    noteFk: foreignKey({
      columns: [table.noteId, table.userId],
      foreignColumns: [notes.id, notes.userId],
      name: "workspace_windows_note_fk",
    }).onDelete("cascade"),

    attachmentFk: foreignKey({
      columns: [table.attachmentId, table.userId],
      foreignColumns: [attachments.id, attachments.userId],
      name: "workspace_windows_attachment_fk",
    }).onDelete("cascade"),

    // Cada tipo aponta para exatamente o que lhe cabe: nota tem nota, anexo
    // tem anexo, post-it e caixa de texto não apontam para nada. Sem isto, um
    // `kind: 'sticky'` com `note_id` preenchido entraria e a leitura teria
    // que decidir qual conteúdo vale.
    kindMatchesTarget: check(
      "workspace_windows_kind_matches_target",
      sql`(kind = 'note') = (note_id IS NOT NULL)
        AND (kind = 'attachment') = (attachment_id IS NOT NULL)`
    ),

    // Limites de sanidade. Não são regra de produto — são o que impede uma
    // janela de 2 bilhões de pixels entrar por um cliente adulterado.
    sane: check(
      "workspace_windows_sane_geometry",
      sql`width BETWEEN 160 AND 4000
        AND height BETWEEN 96 AND 4000
        AND x BETWEEN -200000 AND 200000
        AND y BETWEEN -200000 AND 200000`
    ),
  })
);

export const workspaceWindowsRelations = relations(
  workspaceWindows,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceWindows.workspaceId],
      references: [workspaces.id],
    }),
    note: one(notes, {
      fields: [workspaceWindows.noteId],
      references: [notes.id],
    }),
    attachment: one(attachments, {
      fields: [workspaceWindows.attachmentId],
      references: [attachments.id],
    }),
  })
);

/**
 * Uma flecha de um elemento da lousa para outro.
 *
 * Tabela e não coluna dentro da janela: um array não pode ser chave
 * estrangeira, e é o `ON DELETE CASCADE` das duas FKs abaixo que faz a
 * flecha sumir junto com a ponta que foi fechada — sem uma linha de
 * aplicação. Ver `drizzle/0010_workspace_connections.sql`.
 */
export const workspaceConnections = pgTable(
  "workspace_connections",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    /**
     * De onde a flecha sai e onde ela chega. A direção é a ordem destas
     * duas colunas — uma coluna "direção" seria a mesma informação escrita
     * duas vezes, e as duas poderiam discordar.
     */
    fromWindowId: uuid("from_window_id").notNull(),
    toWindowId: uuid("to_window_id").notNull(),
    /**
     * O que a flecha diz. Nulo quando não há rótulo, e nunca string vazia:
     * "sem rótulo" e "rótulo em branco" são o mesmo estado, e dois jeitos de
     * escrever o mesmo estado viram duas condições em toda leitura.
     *
     * É a única coluna desta tabela que o cliente pode atualizar — o GRANT de
     * 0012 é por coluna, para origem e destino continuarem fora do alcance
     * do PostgREST.
     */
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    workspaceIdx: index("workspace_connections_workspace_id_idx").on(
      table.workspaceId
    ),
    userIdx: index("workspace_connections_user_id_idx").on(table.userId),
    // A ponta de chegada não é a primeira coluna do índice único abaixo,
    // então "o que aponta para esta janela" precisa do índice dela.
    toIdx: index("workspace_connections_to_window_id_idx").on(
      table.toWindowId
    ),

    // A mesma flecha não sai duas vezes. A de volta (B → A) é outra linha de
    // propósito: duas coisas podem apontar uma para a outra.
    pair: uniqueIndex("workspace_connections_pair_idx").on(
      table.fromWindowId,
      table.toWindowId
    ),

    workspaceFk: foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaces.id, workspaces.userId],
      name: "workspace_connections_workspace_fk",
    }).onDelete("cascade"),

    // Três colunas, e não duas. `(id, user_id)` garantiria só que a ponta é
    // da mesma pessoa — uma flecha ainda poderia ligar esta lousa a outra da
    // mesma conta, e a leitura teria que filtrar isso para sempre.
    fromFk: foreignKey({
      columns: [table.fromWindowId, table.workspaceId, table.userId],
      foreignColumns: [
        workspaceWindows.id,
        workspaceWindows.workspaceId,
        workspaceWindows.userId,
      ],
      name: "workspace_connections_from_fk",
    }).onDelete("cascade"),

    toFk: foreignKey({
      columns: [table.toWindowId, table.workspaceId, table.userId],
      foreignColumns: [
        workspaceWindows.id,
        workspaceWindows.workspaceId,
        workspaceWindows.userId,
      ],
      name: "workspace_connections_to_fk",
    }).onDelete("cascade"),

    // Uma flecha de um elemento para ele mesmo não desenha nada e não diz
    // nada.
    notSelf: check(
      "workspace_connections_not_self",
      sql`from_window_id <> to_window_id`
    ),
  })
);

export const workspaceConnectionsRelations = relations(
  workspaceConnections,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceConnections.workspaceId],
      references: [workspaces.id],
    }),
    from: one(workspaceWindows, {
      fields: [workspaceConnections.fromWindowId],
      references: [workspaceWindows.id],
      relationName: "connection_from",
    }),
    to: one(workspaceWindows, {
      fields: [workspaceConnections.toWindowId],
      references: [workspaceWindows.id],
      relationName: "connection_to",
    }),
  })
);

/* -------------------------------------------------------------------------
 * Entrada — notificações do sistema e de outros usuários
 * ---------------------------------------------------------------------- */

/**
 * Tipo da notificação.
 *
 * - `system`: mensagens da Nexo (boas-vindas, atualizações, limites de plano,
 *   avisos de segurança). Quem escreve é o servidor.
 * - `user`: mensagens vindas de outros usuários (compartilhamentos,
 *   convites, menções). Ainda não implementado; a coluna existe para a
 *   classificação não precisar mudar no futuro.
 */
export const notificationTypeEnum = pgEnum("notification_type", [
  "system",
  "user",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    userId: uuid("user_id").notNull(),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    metadata: jsonb("metadata"),
    read: boolean("read").default(false).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdx: index("notifications_user_id_idx").on(table.userId),
    userCreatedIdx: index("notifications_user_created_at_idx").on(
      table.userId,
      table.createdAt
    ),
    unreadIdx: index("notifications_unread_idx").on(table.userId, table.read),
  })
);

/* -------------------------------------------------------------------------
 * Relatórios de erro
 * ---------------------------------------------------------------------- */

/**
 * De onde o erro veio.
 *
 * - `api`: exceção numa rota do servidor (o caminho de `logServerError`).
 * - `ai_job`: o provedor de IA recusou, expirou ou devolveu lixo.
 * - `client`: quebrou no navegador e o error boundary reportou.
 * - `unhandled`: promessa rejeitada sem dono, erro de janela.
 *
 * Enum e não texto livre pelo mesmo motivo de `notification_type`: são quatro
 * origens conhecidas, e uma quinta escrita com erro de digitação sumiria de
 * toda consulta de triagem sem avisar ninguém.
 */
export const errorReportKindEnum = pgEnum("error_report_kind", [
  "api",
  "client",
  "ai_job",
  "unhandled",
]);

/**
 * Um erro que aconteceu, com um código que a pessoa consegue ditar.
 *
 * **Por que uma tabela e não o log do servidor.** O log responde "o que
 * aconteceu no servidor às 18h16" para quem tem acesso ao servidor, e some na
 * rotação. Esta tabela responde "o que aconteceu com **este** usuário, e o
 * que ele estava tentando fazer" — que é a pergunta que o suporte tem, e é a
 * pergunta que o log não consegue responder porque a reclamação chega horas
 * depois, sem hora e sem endpoint.
 *
 * **Por que não estender `ai_jobs` ou `audit_logs`.** `audit_logs` é a trilha
 * de quem-mudou-o-quê; misturar erro ali dilui a única tabela que precisa
 * continuar legível numa investigação, e ela não pode ter retenção. `ai_jobs`
 * é o feed do usuário — metade dos erros não vem de tarefa de IA nenhuma.
 *
 * **Quem escreve.** Só o servidor, pela `DATABASE_URL` — mesma porta de
 * `writeAuditLog` e `notifySystem`. A migration 0015 revoga INSERT/UPDATE/
 * DELETE de `authenticated` e de `anon`, e o `GRANT SELECT` é **por coluna**:
 * `message`, `stack`, `context`, `fingerprint`, `ip_address` e `user_agent`
 * ficam fora do alcance do PostgREST. O dono lê o próprio relatório; ele não
 * lê o que o relatório diz por dentro.
 */
export const errorReports = pgTable(
  "error_reports",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    /** `NX-7F3A-2K9` — ver `lib/errors/code.ts`. Único. */
    code: text("code").notNull(),
    /** Do token, nunca do corpo. Nulo em fluxo não autenticado. */
    userId: uuid("user_id"),
    /** `/api/attachments`, `dashboard/page`, `board:connect`… */
    route: text("route").notNull(),
    kind: errorReportKindEnum("kind").notNull(),
    /** Mensagem interna, já censurada (`lib/errors/redact.ts`). Nunca sai. */
    message: text("message").notNull(),
    /** Idem — interna, com teto de tamanho. */
    stack: text("stack"),
    /** `{ model, status }` e afins. Sem token, sem caminho, sem PII. */
    context: jsonb("context"),
    /**
     * A chave de agrupamento: hash de (kind, rota, mensagem normalizada,
     * dono). Interna — o cliente não a lê, e ela não significa nada para ele.
     */
    fingerprint: text("fingerprint").notNull(),
    /**
     * O dia (UTC) em que este agrupamento começou.
     *
     * O dedupe é `(fingerprint, dedupe_day)`, e não `fingerprint` sozinho: um
     * código que agrupa para sempre acaba dizendo "isto aconteceu 4.000 vezes"
     * sobre uma janela de três meses, e a única pergunta que o suporte tem —
     * "ainda está acontecendo?" — deixa de ter resposta. A janela é o dia do
     * relógio do banco, o mesmo corte de `countMonthlyCaptures`.
     */
    dedupeDay: date("dedupe_day")
      // O default é do banco, e não do runtime, pelo mesmo motivo de
      // `date_trunc('month', now())` em `countMonthlyCaptures`: o corte
      // precisa ser o mesmo para todo mundo, sem depender do fuso de quem
      // está executando.
      .default(sql`(now() AT TIME ZONE 'utc')::date`)
      .notNull(),
    /** O que a **pessoa** escreveu ao reportar. Nulo até ela reportar. */
    userReport: text("user_report"),
    userReportedAt: timestamp("user_reported_at", { withTimezone: true }),
    occurrences: integer("occurrences").default(1).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Triagem do suporte (`bun run errors -- --resolver <código>`). */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => ({
    codeKey: uniqueIndex("error_reports_code_idx").on(table.code),
    // O alvo do `ON CONFLICT`: é ele que transforma a segunda ocorrência num
    // `occurrences + 1` em vez de uma linha nova.
    dedupeKey: uniqueIndex("error_reports_dedupe_idx").on(
      table.fingerprint,
      table.dedupeDay
    ),
    // "Meus erros" é "os meus, do mais recente para o mais antigo".
    userRecentIdx: index("error_reports_user_last_seen_idx").on(
      table.userId,
      table.lastSeenAt
    ),
    // A fila da triagem: o que alguém reportou e ninguém resolveu.
    reportedIdx: index("error_reports_reported_idx").on(table.userReportedAt),
    // A varredura da retenção.
    lastSeenIdx: index("error_reports_last_seen_idx").on(table.lastSeenAt),
  })
);
