-- =========================================================================
-- 0010 — Ligações entre elementos da lousa
--
-- Cria `workspace_connections`: uma flecha de um elemento para outro dentro
-- da mesma lousa.
--
-- Por que uma tabela, e não uma coluna com os ids dentro da própria janela:
--
--   * **Um array não pode ser chave estrangeira.** Com uma coluna de ids,
--     fechar uma janela deixaria as flechas das outras apontando para o
--     nada, e limpar isso viraria código nosso em toda leitura e em toda
--     exclusão. Com FK e ON DELETE CASCADE, a flecha some junto com a ponta
--     — no banco, sem uma linha de aplicação.
--   * **A borracha piora o caso.** O desfazer recria as janelas, e uma lista
--     de ids guardada dentro de outra linha não teria como acompanhar.
--   * **Duas telas.** Uma linha por ligação não colide; um campo com todas
--     as ligações da janela faz a última escrita apagar a ligação que a
--     outra tela acabou de criar.
--   * **Espaço.** Não há economia: um uuid em jsonb é texto de 36 bytes mais
--     as chaves; em coluna é binário de 16.
--
-- Idempotente de ponta a ponta: rodar de novo não quebra nem duplica nada.
-- =========================================================================

-- ----------------------------------------------------------------------
-- 1. O alvo das chaves estrangeiras compostas
--
-- Três colunas, e não duas. `(id, user_id)` garantiria só que a ponta é da
-- mesma pessoa — uma flecha ainda poderia ligar uma janela desta lousa a
-- outra de outra lousa da mesma conta, e a leitura teria que filtrar isso
-- para sempre. Com `(id, workspace_id, user_id)` a ligação entre lousas
-- diferentes é recusada pelo próprio banco.
-- ----------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_windows_id_workspace_id_user_id_key'
  ) THEN
    ALTER TABLE workspace_windows
      ADD CONSTRAINT workspace_windows_id_workspace_id_user_id_key
      UNIQUE (id, workspace_id, user_id);
  END IF;
END
$$;

-- ----------------------------------------------------------------------
-- 2. A tabela
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspace_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL,
  -- De onde a flecha sai e onde ela chega. A direção é a ordem destas duas
  -- colunas: não existe coluna "direção" porque ela seria a mesma
  -- informação escrita duas vezes, e as duas poderiam discordar.
  from_window_id  uuid NOT NULL,
  to_window_id    uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workspace_connections_workspace_fk
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspaces (id, user_id) ON DELETE CASCADE,

  -- O CASCADE aqui é a razão de a tabela existir: fechar ou apagar uma
  -- janela leva embora todas as flechas que encostavam nela.
  CONSTRAINT workspace_connections_from_fk
    FOREIGN KEY (from_window_id, workspace_id, user_id)
    REFERENCES workspace_windows (id, workspace_id, user_id)
    ON DELETE CASCADE,

  CONSTRAINT workspace_connections_to_fk
    FOREIGN KEY (to_window_id, workspace_id, user_id)
    REFERENCES workspace_windows (id, workspace_id, user_id)
    ON DELETE CASCADE,

  -- Uma flecha de um elemento para ele mesmo não desenha nada e não diz
  -- nada.
  CONSTRAINT workspace_connections_not_self
    CHECK (from_window_id <> to_window_id)
);

-- A mesma flecha não sai duas vezes. A de volta (B → A) é outra linha de
-- propósito: duas coisas podem apontar uma para a outra.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_connections_pair_idx
  ON workspace_connections (from_window_id, to_window_id);

-- A lousa lê sempre todas as ligações de um workspace.
CREATE INDEX IF NOT EXISTS workspace_connections_workspace_id_idx
  ON workspace_connections (workspace_id);
CREATE INDEX IF NOT EXISTS workspace_connections_user_id_idx
  ON workspace_connections (user_id);
-- A ponta de chegada não é a primeira coluna do índice único acima, então
-- "o que aponta para esta janela" precisa do índice dela.
CREATE INDEX IF NOT EXISTS workspace_connections_to_window_id_idx
  ON workspace_connections (to_window_id);

-- ----------------------------------------------------------------------
-- 3. RLS
--
-- Três políticas nomeadas, e não um `FOR ALL`: uma ligação não tem o que
-- atualizar — ela é criada, lida e removida. Sem policy de UPDATE, a
-- operação simplesmente não existe pelo PostgREST, e é uma superfície a
-- menos para cuidar. Mesmo espírito do endurecimento de 0005.
-- ----------------------------------------------------------------------

ALTER TABLE workspace_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own connections" ON workspace_connections;
CREATE POLICY "Users read own connections" ON workspace_connections
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users create own connections" ON workspace_connections;
CREATE POLICY "Users create own connections" ON workspace_connections
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own connections" ON workspace_connections;
CREATE POLICY "Users delete own connections" ON workspace_connections
  FOR DELETE USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------
-- 4. Realtime
--
-- Uma flecha criada num dispositivo precisa aparecer no outro. REPLICA
-- IDENTITY FULL porque o payload de DELETE viria só com a chave primária, e
-- o filtro de RLS do Realtime não conseguiria decidir sobre a linha.
-- ----------------------------------------------------------------------

ALTER TABLE workspace_connections REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'workspace_connections'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_connections;
  END IF;
END
$$;
