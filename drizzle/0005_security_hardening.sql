-- =========================================================================
-- 0005 — Endurecimento de segurança: menor privilégio no PostgREST
--
-- Três coisas:
--   1. profiles: o usuário autenticado só pode editar display_name e
--      avatar_url. As colunas de assinatura (plan, subscription_status,
--      stripe_*, current_period_end) passam a ser exclusivas do servidor
--      (conexão Drizzle / service_role). Sem isso, qualquer usuário se daria
--      plan = 'pro' com um PATCH no PostgREST.
--   2. ai_jobs: o dono só LÊ os próprios jobs. A escrita é do worker de IA
--      via conexão privilegiada — o app nunca escreve ai_jobs via PostgREST.
--   3. audit_logs.record_id passa a aceitar NULL para registrar eventos sem
--      registro associado (ex.: tentativa de login falha).
--
-- RLS sozinha não restringe COLUNAS — quem faz isso é GRANT/REVOKE. Por isso
-- a policy de UPDATE em profiles continua (limita à própria linha) e o grant
-- passa a limitar as colunas.
-- =========================================================================

-- ----------------------------------------------------------------------
-- 1. profiles
-- ----------------------------------------------------------------------

REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM anon;
GRANT UPDATE (display_name, avatar_url) ON public.profiles TO authenticated;

-- ----------------------------------------------------------------------
-- 2. ai_jobs
-- ----------------------------------------------------------------------

DROP POLICY IF EXISTS "Users manage own ai jobs" ON ai_jobs;
DROP POLICY IF EXISTS "Users read own ai jobs" ON ai_jobs;
CREATE POLICY "Users read own ai jobs" ON ai_jobs
  FOR SELECT USING (auth.uid() = user_id);

-- Cinto e suspensório: além da RLS, tira o privilégio de escrita da role.
-- O Realtime (postgres_changes) respeita a policy de SELECT, então o painel
-- "Tarefas" continua recebendo eventos normalmente.
REVOKE INSERT, UPDATE, DELETE ON public.ai_jobs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ai_jobs FROM anon;

-- ----------------------------------------------------------------------
-- 3. audit_logs
-- ----------------------------------------------------------------------

ALTER TABLE public.audit_logs ALTER COLUMN record_id DROP NOT NULL;
