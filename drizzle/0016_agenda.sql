-- =========================================================================
-- 0016 — A Agenda
--
-- A lista de tarefas de um dia **é uma nota** (`notes.type = 'task'`), com as
-- caixas guardadas como nós `taskItem` dentro de `content_rich`. Não existe
-- tabela de tarefas: uma tarefa não é uma linha, é um nó do documento.
--
-- Isso não é economia improvisada — é a forma que o schema já previa. O valor
-- 'task' está no enum `note_type` desde a 0001 e nunca foi escrito por
-- ninguém. O que faltava era a data.
--
-- Três colunas entram:
--
--   task_date    — o dia. Vem do relógio LOCAL de quem escreve, validado no
--                  servidor (formato, dia real do calendário, faixa). O corte
--                  UTC de `date_trunc('month', now())` continua valendo para
--                  a cota mensal, que é régua administrativa igual para todo
--                  mundo; um dia de tarefas não é — quem escreve às 21h de
--                  30/08 em UTC-3 tem que cair em 30/08, não em 31/08.
--
--   tasks_total  — derivadas no servidor a partir de `content_rich`, no mesmo
--   tasks_done     lugar e pelo mesmo motivo que `content` já é derivado (ver
--                  0008): o cliente não pode ser a fonte da verdade sobre o
--                  que ele mesmo mandou. Existem para a sala mostrar "5 de 7"
--                  de trinta dias sem baixar o documento de nenhum deles.
--
-- Por que colunas e não chaves em `metadata` jsonb: mesma decisão de
-- `workspace_windows` vs `layout jsonb` (0007). A invariante "uma lista por
-- dia" precisa ser expressa como constraint, e `metadata->>'taskDate'`
-- indexaria um TEXTO — '2026-8-30' e '2026-08-30' seriam dois dias
-- diferentes para o mesmo dia. E `notes.metadata` já está ocupada: a rota de
-- anexos grava o filename ali.
--
-- RLS: nada a fazer. A policy de `notes` é por LINHA (`auth.uid() =
-- user_id`) e não enumera colunas, então coluna nova entra protegida. Mesma
-- razão pela qual a 0008 não mexeu em policy nenhuma.
--
-- Idempotente: rodar de novo não quebra nem duplica nada.
-- =========================================================================

ALTER TABLE notes ADD COLUMN IF NOT EXISTS task_date date;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS tasks_total integer NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS tasks_done  integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN notes.task_date IS
  'O dia desta lista de tarefas, no fuso de quem escreveu. Nulo em toda nota que não é da Agenda — inclusive nas type=task que a IA cria ao classificar um upload.';
COMMENT ON COLUMN notes.tasks_total IS
  'Quantos taskItem existem em content_rich. Derivada pelo servidor a cada escrita — nunca aceita do cliente.';
COMMENT ON COLUMN notes.tasks_done IS
  'Quantos taskItem estão com attrs.checked = true. Derivada pelo servidor, junto com tasks_total.';

-- A invariante do produto: no máximo uma lista por dia, por pessoa.
--
-- Parcial em três eixos, e os três importam:
--
--   type = 'task'            uma nota comum não disputa o dia.
--
--   task_date IS NOT NULL    a IA já classifica upload como type='task' (ver
--                            lib/ai/classify-document.ts). Essas notas não
--                            têm data e não podem colidir entre si — é por
--                            isso que o discriminador da Agenda é a DATA, e
--                            nunca o tipo sozinho.
--
--   status <> 'deleted'      apagar a lista de um dia libera o dia para uma
--                            nova, em vez de deixar a pessoa presa a uma
--                            lista que ela quis descartar. (Recriar custa
--                            outra captura: apagar nunca devolve captura.)
--
-- Quem usa ON CONFLICT contra este índice precisa repetir o predicado
-- inteiro, senão o Postgres não acha índice que case com o alvo e levanta
-- 42P10 em toda requisição — não só nas concorrentes.
CREATE UNIQUE INDEX IF NOT EXISTS notes_user_task_date_key
  ON notes (user_id, task_date)
  WHERE type = 'task' AND task_date IS NOT NULL AND status <> 'deleted';
