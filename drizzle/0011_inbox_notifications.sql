-- =========================================================================
-- 0011 — Sistema de Entrada (inbox/notificações)
--
-- A Entrada é o centro de notificações do usuário. Recebe mensagens do
-- sistema (Nexo) e, no futuro, mensagens de outros usuários (compartilhamentos,
-- convites, menções). A coluna `type` separa as duas classificações desde o
-- início, para a UI e as políticas de RLS não precisarem mudar depois.
--
-- Segurança — as três decisões que importam:
--
--   1. **INSERT e DELETE saem da role `authenticated`.** Quem escreve
--      notificação é o servidor (service_role). Uma notificação que o próprio
--      destinatário pode criar não é notificação, é rascunho; e uma que ele
--      pode apagar esconde o aviso de segurança que ela existe para dar.
--
--   2. **O UPDATE é restrito a duas colunas, e a policy tem `WITH CHECK`.**
--      As duas coisas, não uma. Sem `WITH CHECK`, `USING` só decide de qual
--      linha a pessoa parte — ela poderia rodar
--      `update notifications set user_id = '<outra conta>'` pelo PostgREST e
--      **injetar uma notificação na Entrada de outro usuário**. E sem o GRANT
--      por coluna ela reescreveria `title` e `body` de uma notificação de
--      sistema, que é justamente o texto em que se espera poder confiar.
--      Mesmo padrão de `profiles` em 0005 e de `workspace_connections` em
--      0012.
--
--   3. **FK para `auth.users` com `ON DELETE CASCADE`.** Todas as tabelas
--      deste banco têm; sem ela, apagar uma conta deixaria as notificações
--      dela para trás, órfãs e sem dono para a RLS avaliar.
--
-- A trigger `handle_new_user` ganha um INSERT de boas-vindas, para a Entrada
-- não nascer vazia.
--
-- Idempotente de ponta a ponta: rodar de novo não quebra nem duplica nada.
-- =========================================================================

-- ----------------------------------------------------------------------
-- 1. Tabela e enum
-- ----------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'notification_type' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.notification_type AS ENUM ('system', 'user');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A conta apagada leva a Entrada dela junto.
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  type public.notification_type NOT NULL,
  title text NOT NULL,
  body text,
  metadata jsonb,
  read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx
  ON public.notifications (user_id);
-- A lista da Entrada é "minhas notificações, da mais nova para a mais velha".
CREATE INDEX IF NOT EXISTS notifications_user_created_at_idx
  ON public.notifications (user_id, created_at DESC);
-- O badge do trilho é uma contagem de não lidas, em toda carga do dashboard.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON public.notifications (user_id, read);

-- ----------------------------------------------------------------------
-- 2. RLS
-- ----------------------------------------------------------------------

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  -- Sem esta linha a pessoa move a própria notificação para outra conta.
  WITH CHECK (auth.uid() = user_id);

REVOKE INSERT, DELETE ON public.notifications FROM authenticated;
REVOKE INSERT, DELETE ON public.notifications FROM anon;

-- Marcar como lida e nada mais. `updated_at` fica de fora de propósito: quem
-- escreve nela é a trigger abaixo, que roda como dona da tabela e não é
-- afetada pelo privilégio de coluna de quem disparou o UPDATE.
REVOKE UPDATE ON public.notifications FROM authenticated;
REVOKE UPDATE ON public.notifications FROM anon;
GRANT UPDATE (read, read_at) ON public.notifications TO authenticated;

-- ----------------------------------------------------------------------
-- 3. updated_at
--
-- Reaproveita `update_updated_at_column()`, que já existe desde 0001 e teve o
-- `search_path` travado em 0006. Criar uma segunda função com o mesmo corpo
-- traria de volta exatamente o achado do security advisor que 0006 fechou:
-- função nova nasce executável por PUBLIC.
-- ----------------------------------------------------------------------

DROP TRIGGER IF EXISTS notifications_updated_at ON public.notifications;
CREATE TRIGGER notifications_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------
-- 4. Boas-vindas: toda conta nova recebe uma notificação de sistema
--
-- `CREATE OR REPLACE` preserva os privilégios da função existente, mas os
-- REVOKE de 0006 são repetidos logo abaixo em vez de confiados à preservação:
-- esta é uma função `SECURITY DEFINER` que insere em `profiles`, e o custo de
-- reafirmar é uma linha.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name');

  INSERT INTO public.workspaces (user_id, name, is_default)
  VALUES (NEW.id, 'Pessoal', true);

  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (
    NEW.id,
    'system',
    'Bem-vindo à Nexo',
    'Sua conta está pronta. Comece capturando uma ideia, um arquivo ou uma nota.'
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
