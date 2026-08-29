-- =========================================================================
-- 0004 — Tarefas dos agentes de IA + Realtime para o dashboard
--
-- Duas coisas:
--   1. A tabela ai_jobs, que alimenta o painel "Tarefas".
--   2. A configuração de Realtime nas tabelas que o dashboard escuta, para
--      Tarefas e Recentes sincronizarem entre dispositivos sem polling.
--
-- Idempotente de ponta a ponta: rodar de novo não quebra nem duplica nada.
-- =========================================================================

-- ----------------------------------------------------------------------
-- 1. ai_jobs
-- ----------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_job_kind') THEN
    CREATE TYPE ai_job_kind AS ENUM (
      'classify',
      'summarize',
      'tag',
      'transcribe',
      'extract',
      'organize'
    );
  END IF;

  -- 'insufficient_credits' é terminal-mas-retomável: o trabalho não aconteceu
  -- por falta de crédito e a linha precisa sobreviver para o usuário retomar
  -- depois de assinar. É a razão de este feed viver no Postgres, não em cache.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_job_status') THEN
    CREATE TYPE ai_job_status AS ENUM (
      'queued',
      'running',
      'succeeded',
      'failed',
      'insufficient_credits'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS ai_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  workspace_id  uuid REFERENCES workspaces (id) ON DELETE SET NULL,
  note_id       uuid REFERENCES notes (id) ON DELETE SET NULL,
  kind          ai_job_kind NOT NULL,
  status        ai_job_status NOT NULL DEFAULT 'queued',
  label         text NOT NULL,
  detail        text,
  result        jsonb,
  error         text,
  credits_cost  integer NOT NULL DEFAULT 0,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_jobs_user_id_idx ON ai_jobs (user_id);
CREATE INDEX IF NOT EXISTS ai_jobs_status_idx ON ai_jobs (status);
CREATE INDEX IF NOT EXISTS ai_jobs_note_id_idx ON ai_jobs (note_id);
-- O feed lê sempre as mais recentes do usuário.
CREATE INDEX IF NOT EXISTS ai_jobs_user_created_at_idx
  ON ai_jobs (user_id, created_at DESC);

ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own ai jobs" ON ai_jobs;
CREATE POLICY "Users manage own ai jobs" ON ai_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Reaproveita a função de 0001. `notes` e `workspaces` já têm o gatilho
-- delas desde aquela migration — criar outro aqui faria a mesma coluna ser
-- escrita duas vezes por UPDATE.
DROP TRIGGER IF EXISTS ai_jobs_updated_at ON ai_jobs;
CREATE TRIGGER ai_jobs_updated_at
  BEFORE UPDATE ON ai_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------
-- 2. Realtime
--
-- O dashboard assina postgres_changes nestas três tabelas. O Realtime do
-- Supabase aplica RLS por conexão autenticada: cada cliente só recebe as
-- linhas que a política acima já deixaria ele ler. Nenhum filtro de
-- user_id no cliente é barreira de segurança — o banco é a barreira.
--
-- REPLICA IDENTITY FULL é necessário para os eventos de UPDATE e DELETE
-- carregarem a linha antiga inteira; sem isso o payload vem só com a chave
-- primária e o filtro de RLS do Realtime não consegue decidir sobre ela.
-- ----------------------------------------------------------------------

ALTER TABLE ai_jobs REPLICA IDENTITY FULL;
ALTER TABLE notes REPLICA IDENTITY FULL;
ALTER TABLE workspaces REPLICA IDENTITY FULL;

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['ai_jobs', 'notes', 'workspaces'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target
      );
    END IF;
  END LOOP;
END
$$;
