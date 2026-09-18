-- =========================================================================
-- 0024 — A IA lê a nota que a pessoa escreve
--
-- Até aqui só o upload passava pela IA. Esta migration cria o que falta para
-- a nota escrita à mão também ser resumida e marcada, sem nenhuma das
-- armadilhas do `docs/PLANO-IA-NOTAS.md`:
--
--   1. `note_ai_state` — a contabilidade da IA, **fora de `notes`**. O
--      trigger `notes_updated_at` (0001) dispara em todo UPDATE de `notes`;
--      se o "já li" morasse lá, a IA faria a nota subir em Recentes a cada
--      passada e, pior, se reclassificaria para sempre. O resumo mora aqui
--      pelo mesmo motivo.
--
--   2. `note_tags.source` — de quem é a tag: da pessoa ou da IA. A IA só
--      acrescenta e só mexe nas dela; as da pessoa são intocáveis.
--
--   3. `note_tag_rejections` — a pessoa tirou uma tag que a IA pôs. A IA não
--      a põe de volta. Sem isto o parágrafo seguinte devolve a tag, e essa é
--      a coisa específica que faz alguém desligar o recurso.
--
-- As travas de escrita seguem a doutrina de 0017: **onde o cliente não
-- escreve nada, o GRANT some inteiro.** Toda escrita destas três tabelas sai
-- do servidor pela `DATABASE_URL` (papel `postgres`), que não passa por
-- GRANT. Em particular, `note_tags` perde INSERT/UPDATE/DELETE de
-- `authenticated`: sem isso, um cliente forjado gravaria a própria tag como
-- `source = 'ai'` pelo PostgREST, e a procedência viraria enfeite.
--
-- Idempotente de ponta a ponta.
-- =========================================================================

-- ----------------------------------------------------------------------
-- 1. note_ai_state
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.note_ai_state (
  note_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,

  -- Onde a nota está no ciclo. `idle` = nada a fazer; `pending` = mudou o
  -- bastante e espera a leitura; `skipped` = curta demais para valer uma
  -- chamada; `waiting_configuration` = a instância não tem chave de IA.
  state text NOT NULL DEFAULT 'idle',

  -- Hash do texto normalizado **já lido**. É o guarda: corrigir uma vírgula
  -- não muda o hash, e portanto não vale uma chamada de modelo.
  content_hash text,
  -- Hash do texto normalizado **salvo por último**. Diferente do de cima =
  -- há o que ler.
  dirty_hash text,
  -- Tamanho do texto na última leitura, para o piso de mudança.
  read_chars integer NOT NULL DEFAULT 0,
  read_at timestamptz,

  -- O resumo, e o hash do texto que ele resume. Quando `summary_hash` e
  -- `dirty_hash` divergem, o resumo é de uma versão anterior e a interface
  -- diz isso.
  summary text,
  summary_hash text,
  -- O tipo que a IA acha que a nota é. **Sugestão**, não escrita em
  -- `notes.type`: escrever em `notes` subiria `updated_at` pelo trigger.
  suggested_type public.note_type,

  -- A tarefa do feed que representa o ciclo atual. Uma por ciclo, não uma
  -- por salvamento.
  job_id uuid REFERENCES public.ai_jobs (id) ON DELETE SET NULL,

  -- Tranca e recuo. `claimed_at` destrava sozinho depois de 5 minutos, para
  -- um processo que morreu no meio não prender a nota para sempre.
  claimed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,

  -- Teto diário de leituras por nota: uma nota viva editada o dia inteiro
  -- não vira vinte chamadas.
  runs_day date,
  runs_count integer NOT NULL DEFAULT 0,

  -- A pessoa desliga a IA nesta nota.
  enabled boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  -- Sem trigger, de propósito: escrito à mão por quem muda a linha.
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- A nota tem de ser da mesma pessoa, por construção — FK composta, o
  -- mesmo padrão de `workspace_windows`.
  CONSTRAINT note_ai_state_note_fk FOREIGN KEY (note_id, user_id)
    REFERENCES public.notes (id, user_id) ON DELETE CASCADE,

  CONSTRAINT note_ai_state_state_check CHECK (
    state IN (
      'idle', 'pending', 'running', 'done', 'skipped',
      'waiting_configuration', 'failed'
    )
  ),
  CONSTRAINT note_ai_state_sane_sizes CHECK (
    (summary IS NULL OR length(summary) <= 1200)
    AND attempts BETWEEN 0 AND 100
    AND runs_count BETWEEN 0 AND 1000
  )
);

-- A varredura do dashboard roda em toda carga: sem índice parcial ela vira
-- varredura sequencial no caminho mais quente do produto. Só entram os
-- estados que a varredura acorda — `done`, `idle` e `skipped` são a imensa
-- maioria e ficam fora.
CREATE INDEX IF NOT EXISTS note_ai_state_pending_idx
  ON public.note_ai_state (user_id, updated_at)
  WHERE state IN ('pending', 'failed', 'running', 'waiting_configuration');

CREATE INDEX IF NOT EXISTS note_ai_state_user_idx
  ON public.note_ai_state (user_id);

ALTER TABLE public.note_ai_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own note ai state" ON public.note_ai_state;
CREATE POLICY "Users read own note ai state" ON public.note_ai_state
  FOR SELECT USING (auth.uid() = user_id);

REVOKE ALL ON public.note_ai_state FROM authenticated;
REVOKE ALL ON public.note_ai_state FROM anon;

-- O dono lê o que a interface mostra. Os hashes e a contabilidade da tranca
-- ficam de fora: não são segredo, mas não são de ninguém além do servidor.
GRANT SELECT (
  note_id,
  user_id,
  state,
  summary,
  suggested_type,
  read_at,
  enabled,
  updated_at
) ON public.note_ai_state TO authenticated;

-- O resumo embaixo da nota atualiza ao vivo (Realtime respeita a policy de
-- SELECT acima). FULL pelo mesmo motivo de 0004.
ALTER TABLE public.note_ai_state REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'note_ai_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.note_ai_state;
  END IF;
END
$$;

-- ----------------------------------------------------------------------
-- 2. note_tags.source + fim da escrita pelo navegador
-- ----------------------------------------------------------------------

ALTER TABLE public.note_tags
  ADD COLUMN IF NOT EXISTS source public.note_source NOT NULL DEFAULT 'user';

-- Nenhum componente escreve `note_tags` pelo PostgREST: marcar e desmarcar
-- passam por `/api/notes/[id]/tags`, e a IA escreve pelo servidor. A leitura
-- continua como estava.
REVOKE INSERT, UPDATE, DELETE ON public.note_tags FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.note_tags FROM anon;

-- ----------------------------------------------------------------------
-- 3. note_tag_rejections
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.note_tag_rejections (
  note_id uuid NOT NULL,
  tag_id uuid NOT NULL REFERENCES public.tags (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, tag_id),
  CONSTRAINT note_tag_rejections_note_fk FOREIGN KEY (note_id, user_id)
    REFERENCES public.notes (id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS note_tag_rejections_user_idx
  ON public.note_tag_rejections (user_id);

ALTER TABLE public.note_tag_rejections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own tag rejections" ON public.note_tag_rejections;
CREATE POLICY "Users read own tag rejections" ON public.note_tag_rejections
  FOR SELECT USING (auth.uid() = user_id);

REVOKE ALL ON public.note_tag_rejections FROM authenticated;
REVOKE ALL ON public.note_tag_rejections FROM anon;
GRANT SELECT ON public.note_tag_rejections TO authenticated;
