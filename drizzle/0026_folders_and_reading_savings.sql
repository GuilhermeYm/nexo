-- =========================================================================
-- 0026 — Pastas de notas, e três economias na leitura da IA
--
--   1. `folders` + `note_folders` — a nota passa a ter pasta. A pertença mora
--      **fora de `notes`**, pelo mesmo motivo de `note_ai_state` (0024): o
--      trigger `notes_updated_at` dispara em todo UPDATE de `notes`, e a IA
--      organizando as pastas faria todas as notas subirem em Recentes sem a
--      pessoa ter encostado.
--
--      `note_folders.source` diz quem pôs a nota ali, como em `note_tags`. A
--      IA só move o que ela mesma pôs; o que a pessoa pôs é intocável. Uma
--      linha com `folder_id` nulo e `source = 'user'` é a pessoa dizendo
--      "esta fica sem pasta" — a IA também respeita.
--
--   2. `note_ai_state.summary_chars` — o tamanho da nota quando o resumo foi
--      escrito. É o que permite a "releitura só de tags": mudou pouco desde o
--      resumo, a IA só marca e o resumo continua o da versão anterior.
--
--   3. `note_ai_state.force_summary` — a pessoa pediu ("Reler resumos") para
--      o resumo ser reescrito mesmo com pouca mudança.
--
--   4. `note_ai_state.body_hash` + índice — reaproveitar a leitura de outra
--      nota com o mesmo **corpo** (o título pode ser outro), sem chamar o
--      modelo.
--
-- Escrita só pelo servidor, como em 0024: nenhum GRANT de escrita para
-- `authenticated`. Idempotente de ponta a ponta.
-- =========================================================================

-- ----------------------------------------------------------------------
-- 1. folders
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Quem criou. A pasta da IA que a pessoa renomeia passa a ser dela.
  source public.note_source NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Alvo da FK composta de `note_folders`: a pasta é da mesma pessoa que a
  -- nota, por construção.
  CONSTRAINT folders_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT folders_name_check CHECK (
    char_length(btrim(name)) BETWEEN 1 AND 60
  )
);

-- "Trabalho" e "trabalho" são a mesma pasta.
CREATE UNIQUE INDEX IF NOT EXISTS folders_user_name_idx
  ON public.folders (user_id, lower(btrim(name)));

ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own folders" ON public.folders;
CREATE POLICY "Users read own folders" ON public.folders
  FOR SELECT USING (auth.uid() = user_id);

REVOKE ALL ON public.folders FROM authenticated;
REVOKE ALL ON public.folders FROM anon;
GRANT SELECT (id, user_id, name, source, created_at, updated_at)
  ON public.folders TO authenticated;

-- ----------------------------------------------------------------------
-- 2. note_folders — uma pasta por nota
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.note_folders (
  note_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Nulo só com `source = 'user'`: "sem pasta, por escolha".
  folder_id uuid,
  source public.note_source NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT note_folders_note_fk FOREIGN KEY (note_id, user_id)
    REFERENCES public.notes (id, user_id) ON DELETE CASCADE,
  -- Apagar a pasta devolve as notas para "sem pasta" (a linha some). Com
  -- `folder_id` nulo a FK não é conferida (MATCH SIMPLE), como deve.
  CONSTRAINT note_folders_folder_fk FOREIGN KEY (folder_id, user_id)
    REFERENCES public.folders (id, user_id) ON DELETE CASCADE,
  CONSTRAINT note_folders_null_is_user CHECK (
    folder_id IS NOT NULL OR source = 'user'
  )
);

CREATE INDEX IF NOT EXISTS note_folders_folder_idx
  ON public.note_folders (user_id, folder_id);

ALTER TABLE public.note_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own note folders" ON public.note_folders;
CREATE POLICY "Users read own note folders" ON public.note_folders
  FOR SELECT USING (auth.uid() = user_id);

REVOKE ALL ON public.note_folders FROM authenticated;
REVOKE ALL ON public.note_folders FROM anon;
GRANT SELECT (note_id, user_id, folder_id, source, updated_at)
  ON public.note_folders TO authenticated;

-- ----------------------------------------------------------------------
-- 3. note_ai_state: releitura só de tags, e o pedido de reescrever o resumo
-- ----------------------------------------------------------------------

ALTER TABLE public.note_ai_state
  ADD COLUMN IF NOT EXISTS summary_chars integer,
  ADD COLUMN IF NOT EXISTS summary_at timestamptz,
  ADD COLUMN IF NOT EXISTS force_summary boolean NOT NULL DEFAULT false;

-- Linhas antigas: o resumo foi escrito na última leitura.
UPDATE public.note_ai_state
   SET summary_chars = read_chars,
       summary_at = read_at
 WHERE summary IS NOT NULL
   AND summary_chars IS NULL
   AND summary_hash = content_hash;

-- ----------------------------------------------------------------------
-- 4. Texto idêntico: a leitura de uma nota serve para a outra
-- ----------------------------------------------------------------------

-- Só o corpo, sem o título: a pauta de toda segunda com a data no título, ou
-- o texto colado numa nota nova, são a mesma leitura. `content_hash` junta
-- título e corpo e não serve para isto.
ALTER TABLE public.note_ai_state
  ADD COLUMN IF NOT EXISTS body_hash text;

DROP INDEX IF EXISTS public.note_ai_state_hash_idx;
CREATE INDEX IF NOT EXISTS note_ai_state_body_hash_idx
  ON public.note_ai_state (user_id, body_hash)
  WHERE state = 'done';
