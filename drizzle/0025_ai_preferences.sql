-- =========================================================================
-- 0025 — Preferências de IA da conta e o aviso de limite de leituras
--
-- Três coisas:
--
--   1. `profiles.ai_reasoning_effort` — quanto o modelo pode "pensar" antes
--      de responder (`low` / `medium` / `high`). É custo: no `gpt-oss-120b`,
--      `low` corta ~69% da saída (medido, ver docs/IA-LEITURA.md).
--   2. `profiles.ai_limit_notice` — o que fazer quando uma nota bate o teto
--      diário de leituras: avisar na hora, num resumo do dia, ou não avisar.
--   3. O resumo do dia, pelo `pg_cron`, e o índice que impede o mesmo aviso
--      de entrar duas vezes na Entrada.
--
-- As duas colunas são **da conta** e não do navegador: quem as lê é o
-- servidor, na hora de chamar o modelo. O cliente **não** as escreve pelo
-- PostgREST — `profiles` tem GRANT de UPDATE só em `display_name` e
-- `avatar_url` desde 0005, e colunas novas nascem fora dele. Quem escreve é
-- `PATCH /api/account/ai`, com Zod.
--
-- Idempotente de ponta a ponta.
-- =========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_reasoning_effort text NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS ai_limit_notice text NOT NULL DEFAULT 'immediate';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_ai_preferences_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_ai_preferences_check CHECK (
        ai_reasoning_effort IN ('low', 'medium', 'high')
        AND ai_limit_notice IN ('immediate', 'daily', 'off')
      );
  END IF;
END
$$;

-- ----------------------------------------------------------------------
-- note_ai_state: quando a nota bateu o teto, e quantas leituras extras a
-- pessoa liberou hoje.
-- ----------------------------------------------------------------------

ALTER TABLE public.note_ai_state
  ADD COLUMN IF NOT EXISTS limit_hit_at timestamptz,
  ADD COLUMN IF NOT EXISTS extra_runs integer NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------
-- O mesmo aviso não entra duas vezes.
--
-- É o índice que docs/ENTRADA.md pedia "junto com a primeira notificação
-- automática": `metadata.dedupeKey` identifica o evento, e a inserção vira
-- `ON CONFLICT DO NOTHING`. Sem ele, cada salvamento de uma nota no teto
-- viraria uma linha nova na Entrada.
-- ----------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON public.notifications (user_id, (metadata ->> 'dedupeKey'))
  WHERE metadata ? 'dedupeKey';

-- ----------------------------------------------------------------------
-- O resumo do dia.
--
-- Roda às 02:00 UTC — 23:00 em Brasília, o fuso do projeto. Uma notificação
-- por pessoa que escolheu `daily` e teve nota no teto nas últimas 24 h, com
-- os ids das notas no `metadata` para o botão "Ler mesmo assim".
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_limit_digest()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted integer;
BEGIN
  WITH capped AS (
    SELECT s.user_id,
           array_agg(s.note_id ORDER BY s.limit_hit_at DESC) AS note_ids,
           count(*) AS total
      FROM public.note_ai_state s
      JOIN public.profiles p ON p.id = s.user_id
     WHERE p.ai_limit_notice = 'daily'
       AND s.limit_hit_at > now() - interval '24 hours'
       -- Ainda no teto: a que foi liberada ("Ler mesmo assim") e relida
       -- não é mais notícia. 6 é `MAX_RUNS_PER_DAY` (lib/ai/note-reading.ts).
       AND s.runs_count >= 6 + s.extra_runs
       -- E não avisada na hora — a preferência pode ter mudado no meio do dia.
       AND NOT EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.user_id = s.user_id
            AND n.metadata ->> 'dedupeKey' =
                'ai-limit:' || s.note_id || ':' || to_char(s.limit_hit_at AT TIME ZONE 'utc', 'YYYY-MM-DD')
       )
     GROUP BY s.user_id
  )
  INSERT INTO public.notifications (user_id, type, title, body, metadata)
  SELECT user_id,
         'system',
         CASE WHEN total = 1
              THEN '1 nota chegou ao limite de leituras hoje'
              ELSE total || ' notas chegaram ao limite de leituras hoje'
         END,
         'A Nexo parou de reler para não gastar à toa. Se quiser, libere mais leituras — o resumo e as tags acompanham o que você escreveu depois.',
         jsonb_build_object(
           'kind', 'ai-limit-digest',
           'dedupeKey', 'ai-limit-digest:' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'),
           'action', jsonb_build_object(
             'type', 'ai-extra-reads',
             'label', 'Ler mesmo assim',
             'noteIds', to_jsonb(note_ids[1:50])
           )
         )
    FROM capped
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END
$$;

REVOKE EXECUTE ON FUNCTION public.ai_limit_digest() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_limit_digest() FROM anon, authenticated;

SELECT cron.schedule(
  'ai-limit-digest',
  '0 2 * * *',
  $$ SELECT public.ai_limit_digest() $$
);
