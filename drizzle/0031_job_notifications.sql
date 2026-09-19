-- =========================================================================
-- 0031 — A Entrada avisa o fim das tarefas da IA
--
-- Três coisas:
--
--   1. Uma trigger em `ai_jobs` que escreve na Entrada quando uma tarefa
--      **falha** ou **termina**, com o link para o detalhe dela em Tarefas
--      (tela cheia). É trigger, e não uma chamada em cada worker, porque são
--      cinco caminhos que gravam o fim de uma tarefa (leitura de nota,
--      organização, upload, transcrição, imagem) e o sexto, quando vier, não
--      precisa lembrar de nada.
--
--      **Dois silêncios deliberados.** A leitura de nota que deu certo não
--      avisa: ela roda sozinha a cada edição (até 6 vezes por nota por dia),
--      e avisar cada uma enterraria as falhas e esvaziaria o número do
--      trilho. E a classificação sem chave de IA também não — ver abaixo.
--      A falha de leitura de nota avisa sempre.
--
--      **Uma falha que se resolveu sai de cena sozinha.** A leitura de nota
--      tenta de novo com recuo, e a nova tentativa reusa a mesma tarefa. Se
--      ela der certo depois, o aviso de falha é marcado como lido e ganha
--      `resolvedAt` — a pessoa não abre a Entrada para ler sobre um problema
--      que não existe mais.
--
--      **Nunca derruba a tarefa.** O aviso é *sobre* o que aconteceu, não é o
--      que aconteceu (mesmo contrato de `notifySystem`): qualquer erro aqui
--      vira WARNING, e a escrita em `ai_jobs` segue.
--
--      **Tarefa apagada leva o aviso junto.** Uma segunda trigger, de
--      DELETE, tira da Entrada os avisos de cada tarefa que sai de
--      `ai_jobs` — pela lixeira de uma falha, pela limpeza das concluídas ou
--      pelo que vier. O link "Ver em Tarefas" apontaria para o nada.
--
--   2. `notifications` entra na publication do Realtime, com `REPLICA
--      IDENTITY FULL` — o número de não lidas no trilho acompanha sem
--      recarregar. A RLS de SELECT (0011) é quem decide quem ouve o quê.
--
--   3. Nada muda nas travas: `INSERT` e `DELETE` continuam revogados de
--      `authenticated`. Apagar notificação passou a existir, mas pela rota
--      (`DELETE /api/notifications`), que filtra por `user_id` do token —
--      nunca pelo PostgREST.
--
-- Idempotente de ponta a ponta.
-- =========================================================================

-- ----------------------------------------------------------------------
-- 1. O aviso de fim de tarefa
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_ai_job_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  kind_label text;
  title text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NEW.status = 'succeeded' THEN
      UPDATE public.notifications
         SET read = true,
             read_at = coalesce(read_at, now()),
             metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('resolvedAt', now())
       WHERE user_id = NEW.user_id
         AND metadata ->> 'dedupeKey' = 'job:' || NEW.id || ':failed';

      IF NEW.kind = 'summarize' THEN
        RETURN NEW;
      END IF;
    END IF;

    -- Sem chave de IA, todo upload vira uma classificação "falha" sem erro
    -- nenhum: o classificador determinístico fez o trabalho e o arquivo está
    -- guardado. Isso é configuração, não falha — Tarefas mostra, a Entrada
    -- não repete a cada envio.
    IF NEW.status = 'failed' AND NEW.kind = 'classify'
       AND NEW.error IS NULL AND NEW.error_code IS NULL THEN
      RETURN NEW;
    END IF;

    kind_label := CASE NEW.kind
      WHEN 'summarize' THEN 'Leitura de nota'
      WHEN 'classify' THEN 'Classificação'
      WHEN 'transcribe' THEN 'Transcrição'
      WHEN 'extract' THEN 'Leitura de imagem'
      WHEN 'organize' THEN 'Organização em pastas'
      ELSE 'Tarefa'
    END;

    title := CASE NEW.status
      WHEN 'failed' THEN kind_label || ' falhou'
      ELSE kind_label || ' concluída'
    END;

    INSERT INTO public.notifications (user_id, type, title, body, metadata)
    VALUES (
      NEW.user_id,
      'system',
      title,
      left(
        NEW.label || coalesce(E'\n' || nullif(NEW.detail, ''), ''),
        2000
      ),
      jsonb_build_object(
        'kind', 'job',
        'jobId', NEW.id,
        'jobKind', NEW.kind,
        'status', NEW.status,
        'dedupeKey', 'job:' || NEW.id || ':' || NEW.status,
        'href', '/dashboard?tarefa=' || NEW.id
      )
    )
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_ai_job_outcome(%): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.notify_ai_job_outcome() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_ai_job_outcome() FROM anon, authenticated;

DROP TRIGGER IF EXISTS ai_jobs_notify_outcome ON public.ai_jobs;
CREATE TRIGGER ai_jobs_notify_outcome
  AFTER INSERT OR UPDATE OF status ON public.ai_jobs
  FOR EACH ROW
  WHEN (NEW.status IN ('succeeded', 'failed'))
  EXECUTE FUNCTION public.notify_ai_job_outcome();

-- Por comando, com a tabela de transição: limpar cem concluídas é um
-- DELETE em `notifications`, não cem.
CREATE OR REPLACE FUNCTION public.forget_ai_job_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    DELETE FROM public.notifications n
     USING gone g
     WHERE n.user_id = g.user_id
       AND n.metadata ->> 'jobId' = g.id::text;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'forget_ai_job_notifications: %', SQLERRM;
  END;
  RETURN NULL;
END
$$;

REVOKE EXECUTE ON FUNCTION public.forget_ai_job_notifications() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.forget_ai_job_notifications() FROM anon, authenticated;

DROP TRIGGER IF EXISTS ai_jobs_forget_notifications ON public.ai_jobs;
CREATE TRIGGER ai_jobs_forget_notifications
  AFTER DELETE ON public.ai_jobs
  REFERENCING OLD TABLE AS gone
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.forget_ai_job_notifications();

-- ----------------------------------------------------------------------
-- 2. Realtime para o número do trilho
-- ----------------------------------------------------------------------

ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END
$$;
