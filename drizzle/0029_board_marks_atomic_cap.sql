-- Serializa criações por lousa e faz o teto continuar verdadeiro mesmo com
-- POSTs concorrentes ou uma futura rota esquecendo a conferência amigável.
CREATE OR REPLACE FUNCTION public.enforce_board_marks_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text, 0));
  IF (SELECT count(*) FROM public.workspace_board_marks
      WHERE workspace_id = NEW.workspace_id) >= 5000 THEN
    RAISE EXCEPTION 'workspace board marks limit reached'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_board_marks_cap ON public.workspace_board_marks;
CREATE TRIGGER workspace_board_marks_cap
BEFORE INSERT ON public.workspace_board_marks
FOR EACH ROW EXECUTE FUNCTION public.enforce_board_marks_cap();

REVOKE ALL ON FUNCTION public.enforce_board_marks_cap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_board_marks_cap() FROM anon, authenticated;
