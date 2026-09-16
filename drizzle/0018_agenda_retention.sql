-- =========================================================================
-- 0018 — As listas da Agenda somem depois de uma semana
--
-- Cada dia da Agenda é uma linha em `notes` (`task_date is not null`), e sem
-- isto elas ficariam guardadas para sempre. A varredura roda uma vez por dia
-- no próprio banco, pelo `pg_cron`: não depende de ninguém abrir a página, e
-- não existe processo agendado fora do Postgres neste projeto.
--
-- **O corte.** Fica a lista de hoje e a dos sete dias anteriores. O "hoje" do
-- banco é UTC, e o `task_date` é o dia de quem escreveu (ver docs/AGENDA.md):
-- a diferença é de no máximo 14 horas, e a sobra de um dia no corte faz com
-- que nenhum fuso perca uma lista antes de completar a semana.
--
-- **Apaga de verdade**, e não `status = 'deleted'`: o motivo é não guardar.
-- O que depende da nota já está resolvido pelas chaves estrangeiras —
-- `note_tags` e as janelas da lousa saem em cascata; `attachments`, `ai_jobs`
-- e `notes.parent_id` ficam com `SET NULL`, então nenhum arquivo é perdido.
--
-- O discriminador é `task_date`, nunca `type` sozinho: as notas `type='task'`
-- que a IA cria ao classificar um upload não têm data e são capturas de
-- verdade. Esta varredura não pode tocar nelas.
--
-- Apagar listas antigas não devolve captura: a cota conta por `created_at`
-- dentro do mês (docs/PLANOS.md).
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

GRANT USAGE ON SCHEMA cron TO postgres;

-- `cron.schedule` com nome substitui o job de mesmo nome: reaplicar esta
-- migration não duplica a varredura.
SELECT cron.schedule(
  'purge-old-agenda-lists',
  '15 3 * * *',
  $$
    DELETE FROM public.notes
    WHERE type = 'task'
      AND task_date IS NOT NULL
      AND task_date < (now() AT TIME ZONE 'utc')::date - 8
  $$
);
