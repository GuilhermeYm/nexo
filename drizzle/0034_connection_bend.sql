-- =========================================================================
-- 0034 — Forma e alça das ligações
--
-- A ligação continua calculando início e fim a cada quadro pelas janelas.
-- Só a alça da curva é persistida, relativa ao segmento: `bend_t` diz onde
-- ela cai ao longo da reta e `bend_offset`, quanto sai perpendicularmente.
-- Assim ela continua fazendo sentido depois de mover qualquer ponta.
--
-- Idempotente de ponta a ponta.
-- =========================================================================

ALTER TABLE workspace_connections
  ADD COLUMN IF NOT EXISTS shape text NOT NULL DEFAULT 'straight',
  ADD COLUMN IF NOT EXISTS bend_t double precision,
  ADD COLUMN IF NOT EXISTS bend_offset double precision;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_connections_shape_check'
  ) THEN
    ALTER TABLE workspace_connections
      ADD CONSTRAINT workspace_connections_shape_check
      CHECK (shape IN ('straight', 'curved'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_connections_bend_t_check'
  ) THEN
    ALTER TABLE workspace_connections
      ADD CONSTRAINT workspace_connections_bend_t_check
      CHECK (bend_t IS NULL OR (bend_t >= 0 AND bend_t <= 1));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_connections_bend_offset_check'
  ) THEN
    ALTER TABLE workspace_connections
      ADD CONSTRAINT workspace_connections_bend_offset_check
      CHECK (bend_offset IS NULL OR (bend_offset >= -20000 AND bend_offset <= 20000));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_connections_bend_pair_check'
  ) THEN
    ALTER TABLE workspace_connections
      ADD CONSTRAINT workspace_connections_bend_pair_check
      CHECK ((bend_t IS NULL) = (bend_offset IS NULL));
  END IF;
END
$$;

-- A policy escolhe as linhas; o GRANT limita as colunas que o PostgREST pode
-- alterar. A geometria das pontas, origem, destino, lousa e dono continuam
-- fora do alcance do cliente.
REVOKE UPDATE ON public.workspace_connections FROM authenticated;
REVOKE UPDATE ON public.workspace_connections FROM anon;
GRANT UPDATE (label, tone, stroke, weight, heads, shape, bend_t, bend_offset)
  ON public.workspace_connections TO authenticated;
