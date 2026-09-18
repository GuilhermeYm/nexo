-- Remove o que sobrou da assinatura.
--
-- O produto deixou de ter plano e cobrança: cada pessoa sobe a própria
-- instância e paga o próprio Supabase. As colunas abaixo nunca chegaram a ser
-- escritas por nada além do valor padrão — a integração com o Stripe não
-- existiu —, então não há dado a preservar.
--
-- **Esta migration é destrutiva** e, ao contrário das outras, apaga colunas.
-- Ela é idempotente (`IF EXISTS`), mas não tem volta: aplique sabendo disso.

-- @separate-transaction
DROP INDEX IF EXISTS profiles_stripe_customer_id_idx;

ALTER TABLE profiles
  DROP COLUMN IF EXISTS subscription_status,
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id,
  DROP COLUMN IF EXISTS plan,
  DROP COLUMN IF EXISTS current_period_end;

-- @separate-transaction
-- Os tipos ficam órfãos depois que a última coluna que os usava sai.
DROP TYPE IF EXISTS subscription_status;

DROP TYPE IF EXISTS plan;
