-- =========================================================================
-- 0012 — O rótulo da ligação
--
-- A flecha passa a poder dizer o que ela é. Até aqui ela mostrava que duas
-- coisas se relacionam e calava o resto — "vem de", "contradiz", "resumo de"
-- ficavam na cabeça de quem desenhou.
--
-- Isto **muda uma decisão de 0010**, que dizia: "uma ligação não tem o que
-- atualizar, então não existe policy de UPDATE". Ela tinha razão enquanto a
-- linha era só três ids: mudar a direção é apagar e ligar de novo. Um rótulo
-- é a primeira coisa aqui dentro que é conteúdo, e conteúdo se corrige sem
-- refazer a relação.
--
-- O UPDATE que se abre é o mais estreito possível: policy própria **e** GRANT
-- só na coluna `label`. Origem, destino, lousa e dono continuam fora do
-- alcance do PostgREST — mesmo padrão do endurecimento de `profiles` em 0005,
-- onde só `display_name` e `avatar_url` são escrevíveis pelo cliente.
--
-- Idempotente de ponta a ponta.
-- =========================================================================

-- ----------------------------------------------------------------------
-- 1. A coluna
--
-- Nula quando não há rótulo, e não string vazia: "sem rótulo" e "rótulo em
-- branco" são o mesmo estado, e dois jeitos de escrever o mesmo estado viram
-- duas condições em toda leitura. Quem apaga o texto grava NULL.
--
-- O teto de 80 caracteres é do banco, não só do Zod. Um rótulo é uma
-- etiqueta em cima de um traço de lousa; o que não cabe ali cabe numa nota.
-- ----------------------------------------------------------------------

ALTER TABLE workspace_connections
  ADD COLUMN IF NOT EXISTS label text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_connections_label_length'
  ) THEN
    ALTER TABLE workspace_connections
      ADD CONSTRAINT workspace_connections_label_length
      CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 80);
  END IF;
END
$$;

-- ----------------------------------------------------------------------
-- 2. O UPDATE, restrito à coluna
--
-- A policy sozinha não bastaria: com ela e o GRANT de tabela inteira, o
-- cliente poderia reescrever `from_window_id` e mudar para onde a flecha
-- aponta sem passar pela checagem que a rota faz. O GRANT por coluna é o que
-- fecha isso no banco.
-- ----------------------------------------------------------------------

DROP POLICY IF EXISTS "Users update own connections" ON workspace_connections;
CREATE POLICY "Users update own connections" ON workspace_connections
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE UPDATE ON public.workspace_connections FROM authenticated;
REVOKE UPDATE ON public.workspace_connections FROM anon;
GRANT UPDATE (label) ON public.workspace_connections TO authenticated;
