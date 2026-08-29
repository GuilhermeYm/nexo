-- =========================================================================
-- 0007 — A lousa: janelas de um workspace
--
-- Cria `workspace_windows`, a tabela que guarda o arranjo da lousa: o que
-- está aberto, onde, de que tamanho e em que ordem de empilhamento.
--
-- Por que no Postgres e não no localStorage: o arranjo é trabalho da pessoa,
-- e trabalho precisa atravessar dispositivos. O que é de dispositivo — para
-- onde a tela está olhando, ou seja pan e zoom — esse fica no storage local
-- do navegador e nunca chega aqui.
--
-- Idempotente de ponta a ponta: rodar de novo não quebra nem duplica nada.
-- =========================================================================

-- ----------------------------------------------------------------------
-- 1. Chaves compostas nas tabelas-alvo
--
-- São o alvo das duas chaves estrangeiras compostas da seção 3. Sem elas o
-- isolamento entre usuários dependeria só do código da aplicação; com elas,
-- uma janela apontando para o workspace ou para a nota de outra pessoa é
-- recusada pelo próprio banco.
-- ----------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_id_user_id_key'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_id_user_id_key UNIQUE (id, user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notes_id_user_id_key'
  ) THEN
    ALTER TABLE notes
      ADD CONSTRAINT notes_id_user_id_key UNIQUE (id, user_id);
  END IF;
END
$$;

-- ----------------------------------------------------------------------
-- 2. Tipos
-- ----------------------------------------------------------------------

DO $$
BEGIN
  -- 'note' aponta para uma linha em notes — o conteúdo continua achável pela
  -- busca e pelas tags mesmo estando na lousa. 'sticky' e 'text' existem só
  -- na lousa e guardam o próprio conteúdo na coluna `content`.
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'workspace_window_kind'
  ) THEN
    CREATE TYPE workspace_window_kind AS ENUM ('note', 'sticky', 'text');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'workspace_window_state'
  ) THEN
    CREATE TYPE workspace_window_state AS ENUM (
      'normal',
      'minimized',
      'maximized'
    );
  END IF;
END
$$;

-- ----------------------------------------------------------------------
-- 3. A tabela
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspace_windows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL,
  -- Preenchido só quando kind = 'note'.
  note_id       uuid,
  kind          workspace_window_kind NOT NULL DEFAULT 'note',
  -- Reaproveita o enum de notes.source: a pergunta "quem pôs isto aqui" é a
  -- mesma, e a resposta precisa continuar visível — autoria da IA nunca é
  -- apagada.
  source        note_source NOT NULL DEFAULT 'user',
  -- Conteúdo dos elementos que não são nota: { text, tone }.
  content       jsonb,
  x             integer NOT NULL DEFAULT 0,
  y             integer NOT NULL DEFAULT 0,
  width         integer NOT NULL DEFAULT 320,
  height        integer NOT NULL DEFAULT 220,
  z_index       integer NOT NULL DEFAULT 0,
  state         workspace_window_state NOT NULL DEFAULT 'normal',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Isolamento no banco, não na aplicação. As duas pontas precisam ser do
  -- mesmo dono para a linha entrar. O Postgres usa MATCH SIMPLE por padrão,
  -- então a segunda FK simplesmente não é verificada quando note_id é nulo —
  -- que é exatamente o caso dos elementos próprios da lousa.
  CONSTRAINT workspace_windows_workspace_fk
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspaces (id, user_id) ON DELETE CASCADE,

  CONSTRAINT workspace_windows_note_fk
    FOREIGN KEY (note_id, user_id)
    REFERENCES notes (id, user_id) ON DELETE CASCADE,

  -- Janela de nota tem nota; elemento da lousa não tem. Sem isto, um sticky
  -- com note_id preenchido entraria e a leitura teria que decidir qual dos
  -- dois conteúdos vale.
  CONSTRAINT workspace_windows_kind_matches_note
    CHECK ((kind = 'note') = (note_id IS NOT NULL)),

  -- Limites de sanidade. Não são regra de produto — são o que impede uma
  -- janela de dois bilhões de pixels entrar por um cliente adulterado.
  CONSTRAINT workspace_windows_sane_geometry
    CHECK (
      width BETWEEN 160 AND 4000
      AND height BETWEEN 96 AND 4000
      AND x BETWEEN -200000 AND 200000
      AND y BETWEEN -200000 AND 200000
    )
);

-- A lousa lê sempre todas as janelas de um workspace.
CREATE INDEX IF NOT EXISTS workspace_windows_workspace_id_idx
  ON workspace_windows (workspace_id);
CREATE INDEX IF NOT EXISTS workspace_windows_user_id_idx
  ON workspace_windows (user_id);
CREATE INDEX IF NOT EXISTS workspace_windows_note_id_idx
  ON workspace_windows (note_id);

-- A mesma nota não abre duas vezes na mesma lousa. Nulos não colidem entre si
-- no Postgres, então os elementos próprios da lousa passam à vontade.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_windows_workspace_note_idx
  ON workspace_windows (workspace_id, note_id);

-- ----------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------

ALTER TABLE workspace_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own workspace windows" ON workspace_windows;
CREATE POLICY "Users manage own workspace windows" ON workspace_windows
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Reaproveita a função de 0001.
DROP TRIGGER IF EXISTS workspace_windows_updated_at ON workspace_windows;
CREATE TRIGGER workspace_windows_updated_at
  BEFORE UPDATE ON workspace_windows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------
-- 5. Realtime
--
-- Duas telas abertas na mesma lousa precisam concordar sobre onde as coisas
-- estão. REPLICA IDENTITY FULL é necessário para os eventos de UPDATE e
-- DELETE carregarem a linha inteira; sem isso o payload viria só com a chave
-- primária e o filtro de RLS do Realtime não conseguiria decidir sobre ela.
-- ----------------------------------------------------------------------

ALTER TABLE workspace_windows REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'workspace_windows'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_windows;
  END IF;
END
$$;
