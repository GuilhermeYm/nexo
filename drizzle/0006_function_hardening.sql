-- =========================================================================
-- 0006 — Correções apontadas pelo security advisor do Supabase
--
--   1. update_updated_at_column com search_path travado (evita hijack de
--      search_path em função chamada por triggers de todas as tabelas).
--   2. handle_new_user e rls_auto_enable são funções internas (trigger),
--      mas por padrão eram executáveis via RPC por anon/authenticated.
--      Nada no app chama essas funções via PostgREST — revogar EXECUTE
--      das roles de API não quebra o trigger (que roda como owner).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;

-- O EXECUTE vem de PUBLIC (default do Postgres) e anon/authenticated herdam
-- dele — revogar só das duas roles não basta. service_role recebe de volta
-- explicitamente para não perder a herança de PUBLIC.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;
