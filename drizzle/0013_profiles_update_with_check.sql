-- =========================================================================
-- 0013 — `WITH CHECK` na policy de UPDATE de `profiles`
--
-- A policy nasceu em 0001 com `USING` e sem `WITH CHECK`. As duas cláusulas
-- respondem perguntas diferentes:
--
--   USING      — de qual linha esta pessoa pode partir?
--   WITH CHECK — em qual linha ela pode chegar?
--
-- Só com `USING`, `update profiles set id = '<outra conta>'` é aceito: a
-- linha de origem é dela, e ninguém pergunta sobre a de destino. O perfil
-- muda de dono, e o `id` é a chave que liga a `auth.users` — a pessoa passa a
-- ter uma linha de `profiles` no lugar da de outro usuário.
--
-- Hoje isso não é explorável: o `GRANT UPDATE` de 0005 é por coluna
-- (`display_name`, `avatar_url`), e `id` não está nelas. Ou seja, a única
-- coisa entre esta policy e o problema é um GRANT — e o dia em que alguém
-- precisar liberar mais uma coluna, o buraco abre sozinho e em silêncio.
-- Fechar aqui é fechar onde a regra mora.
--
-- É a mesma correção que `notifications` já nasceu com em 0011 e que
-- `workspace_connections` recebeu em 0012. As demais tabelas usam policy
-- `FOR ALL`, onde o Postgres aplica o `USING` como `WITH CHECK` implícito.
--
-- Idempotente.
-- =========================================================================

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
