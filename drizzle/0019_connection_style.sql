-- =========================================================================
-- 0019 — A aparência da ligação
--
-- A flecha deixa de ser um traço cinza igual para todas. Com o inspetor da
-- ligação, a pessoa escolhe cor, tipo de traço, espessura e pontas — o que
-- ajuda a separar "causa" de "exemplo" de "contradiz" sem ler o rótulo.
--
-- Quatro colunas de texto com CHECK, e não um `style jsonb`:
--
-- 1. O GRANT é por coluna. Um jsonb abriria para o PostgREST qualquer chave
--    que alguém inventasse dentro dele; aqui o banco só aceita o que existe.
-- 2. Os valores são enums pequenos e fechados. CHECK é o lugar deles.
-- 3. Os padrões (`solid`, `regular`, `end`, cor nula) são exatamente a
--    flecha que já existia — as linhas antigas não mudam de cara.
--
-- A cor é **nula** por padrão, e não '0': "sem cor" é o traço neutro que
-- acompanha o tema, e dois jeitos de escrever isso virariam duas condições
-- em toda leitura (mesmo argumento do rótulo em 0012).
--
-- Idempotente de ponta a ponta.
-- =========================================================================

ALTER TABLE workspace_connections
  ADD COLUMN IF NOT EXISTS tone text,
  ADD COLUMN IF NOT EXISTS stroke text NOT NULL DEFAULT 'solid',
  ADD COLUMN IF NOT EXISTS weight text NOT NULL DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS heads text NOT NULL DEFAULT 'end';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_connections_tone_check'
  ) THEN
    ALTER TABLE workspace_connections
      ADD CONSTRAINT workspace_connections_tone_check
      CHECK (tone IS NULL OR tone IN ('1', '2', '3', '4', '5', '6'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_connections_stroke_check'
  ) THEN
    ALTER TABLE workspace_connections
      ADD CONSTRAINT workspace_connections_stroke_check
      CHECK (stroke IN ('solid', 'dashed', 'dotted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_connections_weight_check'
  ) THEN
    ALTER TABLE workspace_connections
      ADD CONSTRAINT workspace_connections_weight_check
      CHECK (weight IN ('thin', 'regular', 'bold'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_connections_heads_check'
  ) THEN
    ALTER TABLE workspace_connections
      ADD CONSTRAINT workspace_connections_heads_check
      CHECK (heads IN ('none', 'end', 'both'));
  END IF;
END
$$;

-- ----------------------------------------------------------------------
-- O UPDATE continua restrito por coluna: rótulo e aparência, e nada mais.
-- Origem, destino, lousa e dono seguem fora do alcance do PostgREST.
-- ----------------------------------------------------------------------

REVOKE UPDATE ON public.workspace_connections FROM authenticated;
REVOKE UPDATE ON public.workspace_connections FROM anon;
GRANT UPDATE (label, tone, stroke, weight, heads)
  ON public.workspace_connections TO authenticated;
