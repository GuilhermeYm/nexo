-- =========================================================================
-- 0020 — A lista da Agenda dura exatamente sete dias
--
-- 0018 cortava em `task_date < hoje_utc - 8`, às 03:15 UTC: a lista do dia 16
-- só saía na madrugada do dia 25, então ficava nove dias na conta. O pedido é
-- uma semana exata:
--
--   a lista do dia D fica visível de D até D+6 (sete dias) e é apagada no
--   começo do dia D+7, o oitavo dia.
--
-- Por isso o corte é `task_date <= hoje - 7`, e o horário passa a ser 03:05
-- UTC, que dá 00:05 em Brasília (UTC−3). Nesse instante a data UTC e a data
-- de Brasília coincidem, e o "hoje" do banco é o mesmo dia de quem usa. Um fuso
-- muito diferente do Brasil pode ver a lista sair algumas horas antes ou
-- depois da meia-noite dele, nunca um dia inteiro.
--
-- `cron.schedule` com o mesmo nome substitui o job de 0018. O resto das
-- regras não muda: apaga de verdade, só `task_date` não nulo, não devolve
-- captura.
-- =========================================================================

SELECT cron.schedule(
  'purge-old-agenda-lists',
  '5 3 * * *',
  $$
    DELETE FROM public.notes
    WHERE type = 'task'
      AND task_date IS NOT NULL
      AND task_date <= (now() AT TIME ZONE 'utc')::date - 7
  $$
);
