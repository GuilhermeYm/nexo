-- =========================================================================
-- 0014 — `audit_logs` fica só de leitura para o cliente
--
-- 0005 tirou INSERT/UPDATE/DELETE de `ai_jobs` da role `authenticated` com um
-- argumento que vale igual aqui: quem escreve é o servidor, e um registro que
-- o próprio interessado edita não é registro de nada. `audit_logs` ficou de
-- fora daquela migration — o GRANT continuava de pé.
--
-- **Não era explorável hoje**, e vale dizer por quê para ninguém achar que a
-- correção é maior do que é: a tabela tem RLS ligada e **uma** policy, de
-- SELECT. Sem policy de INSERT, a RLS recusa a inserção mesmo com o GRANT na
-- mão; sem policy de UPDATE ou DELETE, as duas alcançam zero linhas.
--
-- O problema é o mesmo de 0013: a única coisa entre o GRANT e o buraco é a
-- ausência de uma policy. No dia em que alguém precisar de uma policy de
-- UPDATE aqui — para marcar um registro como revisado, digamos — ela abriria
-- junto o direito de reescrever `old_data` e `new_data`. Quem audita não pode
-- depender de não ter sido lembrado.
--
-- A trilha continua legível pelo dono (`Users read own audit logs`), e quem
-- escreve continua sendo `writeAuditLog`, que entra pela `DATABASE_URL` e não
-- passa por estes GRANTs.
--
-- Idempotente.
-- =========================================================================

REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM anon;
