-- =========================================================================
-- 0015 — Relatórios de erro (`error_reports`) e o código no feed de Tarefas
--
-- O que motivou, concretamente: um upload de PDF gerou uma linha em `ai_jobs`
-- com `status = 'failed'` e `error = NULL`. A classificação caiu no stub
-- porque a chamada ao provedor falhou — timeout, cota ou 503, e não há como
-- saber qual. O motivo real foi para o `console.error` do servidor naquele
-- minuto e **já rotacionou**. A linha registrava que falhou e jogava fora o
-- porquê; a pessoa via "não consegui classificar" e não tinha o que dizer ao
-- suporte além disso.
--
-- Esta migration cria a tabela que guarda o porquê, com um código curto e
-- ditável (`NX-7F3A-2K9`) ligando a reclamação da pessoa ao que o servidor
-- viu.
--
-- As três decisões de segurança:
--
--   1. **Ninguém escreve pelo navegador.** INSERT/UPDATE/DELETE saem de
--      `authenticated` e de `anon`. Quem grava é o servidor, pela
--      `DATABASE_URL` — mesma porta de `writeAuditLog` e `notifySystem`. Um
--      relatório que o interessado edita não é relatório de nada, e o campo
--      `user_report` (a única coisa que a pessoa escreve aqui) entra por uma
--      rota que confere a sessão, não pelo PostgREST.
--
--   2. **O `GRANT SELECT` é por coluna.** `message`, `stack`, `context` e
--      `fingerprint` são texto interno: mensagem crua do Postgres, do
--      provedor de IA, stack trace com caminhos do servidor. Eles não podem
--      chegar ao cliente nem pela resposta da rota nem pelo PostgREST — e
--      `ip_address`/`user_agent` ficam fora pelo mesmo motivo que ficam em
--      `audit_logs`. Duas travas, como em `profiles` (0005), `notifications`
--      (0011) e `workspace_connections` (0012).
--
--   3. **A policy é só de SELECT, e do dono.** Linhas com `user_id` nulo —
--      erro em fluxo não autenticado — não são de ninguém: `auth.uid() = NULL`
--      é NULL, e NULL não é verdadeiro. Elas existem só para a triagem, que
--      entra pela conexão privilegiada.
--
-- E `ai_jobs` ganha `error_code`: sem ela o feed de Tarefas continuaria
-- dizendo "não consegui" sem dizer o que a pessoa faz com isso.
--
-- Idempotente de ponta a ponta.
-- =========================================================================

-- ----------------------------------------------------------------------
-- 1. Enum e tabela
-- ----------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'error_report_kind' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.error_report_kind AS ENUM
      ('api', 'client', 'ai_job', 'unhandled');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.error_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- O identificador curto e ditável. Nunca um uuid: este é o valor que a
  -- pessoa lê no telefone e cola no e-mail do suporte.
  code text NOT NULL,

  -- Do token, nunca do corpo. Nulo quando o erro aconteceu deslogado — e a
  -- conta apagada leva os relatórios dela junto, como toda tabela daqui.
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,

  route text NOT NULL,
  kind public.error_report_kind NOT NULL,

  -- Internas. Ver o GRANT lá embaixo: nenhuma das três é legível pelo
  -- cliente, nem quando ele é o dono da linha.
  message text NOT NULL,
  stack text,
  context jsonb,
  fingerprint text NOT NULL,

  -- A janela do agrupamento. `(fingerprint, dedupe_day)` é único: a segunda
  -- ocorrência do mesmo erro no mesmo dia incrementa `occurrences` em vez de
  -- cunhar um código novo, e o dia seguinte recomeça a contagem.
  dedupe_day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,

  -- O que a pessoa escreveu ao apertar "Reportar". Nulo até ela reportar.
  user_report text,
  user_reported_at timestamptz,

  occurrences integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,

  ip_address text,
  user_agent text,

  -- Tetos de sanidade no próprio banco. Não são regra de produto: são o que
  -- impede um cliente adulterado de usar `user_report` como armazenamento.
  CONSTRAINT error_reports_sane_sizes CHECK (
    length(code) BETWEEN 3 AND 32
    AND length(route) <= 200
    AND length(message) <= 4000
    AND (stack IS NULL OR length(stack) <= 8000)
    AND (user_report IS NULL OR length(user_report) <= 2000)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS error_reports_code_idx
  ON public.error_reports (code);

-- O alvo do ON CONFLICT — é ele que faz o dedupe existir.
CREATE UNIQUE INDEX IF NOT EXISTS error_reports_dedupe_idx
  ON public.error_reports (fingerprint, dedupe_day);

-- "Meus erros": os meus, do mais recente para o mais antigo.
CREATE INDEX IF NOT EXISTS error_reports_user_last_seen_idx
  ON public.error_reports (user_id, last_seen_at DESC);

-- A fila da triagem: o que alguém reportou e ninguém resolveu.
CREATE INDEX IF NOT EXISTS error_reports_reported_idx
  ON public.error_reports (user_reported_at DESC)
  WHERE user_reported_at IS NOT NULL AND resolved_at IS NULL;

-- A varredura da retenção.
CREATE INDEX IF NOT EXISTS error_reports_last_seen_idx
  ON public.error_reports (last_seen_at);

-- ----------------------------------------------------------------------
-- 2. RLS
-- ----------------------------------------------------------------------

ALTER TABLE public.error_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own error reports" ON public.error_reports;
CREATE POLICY "Users read own error reports" ON public.error_reports
  FOR SELECT USING (auth.uid() = user_id);

-- Não há policy de INSERT, UPDATE ou DELETE, e isso é a funcionalidade: a
-- RLS recusaria a escrita mesmo com GRANT na mão. Os REVOKE abaixo são a
-- segunda tranca — para o dia em que alguém precisar de uma policy de UPDATE
-- aqui (marcar como resolvido por uma tela interna, digamos) e abrir junto,
-- sem perceber, o direito de reescrever `message`. Mesma lição de 0014.
REVOKE ALL ON public.error_reports FROM authenticated;
REVOKE ALL ON public.error_reports FROM anon;

-- O dono lê o próprio relatório — e não lê o que ele diz por dentro.
GRANT SELECT (
  code,
  route,
  kind,
  user_report,
  user_reported_at,
  occurrences,
  first_seen_at,
  last_seen_at,
  resolved_at
) ON public.error_reports TO authenticated;

-- ----------------------------------------------------------------------
-- 3. `ai_jobs.error_code`
--
-- Texto solto e não chave estrangeira, de propósito: a retenção apaga
-- relatórios antigos, e um `ON DELETE SET NULL` limparia justamente o código
-- que a linha do feed já mostrou para a pessoa. O job guarda o que exibiu.
--
-- `authenticated` não escreve em `ai_jobs` desde 0005, então a coluna nova
-- nasce fora do alcance do cliente sem precisar de GRANT nenhum.
-- ----------------------------------------------------------------------

ALTER TABLE public.ai_jobs
  ADD COLUMN IF NOT EXISTS error_code text;
