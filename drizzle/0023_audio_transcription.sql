-- =========================================================================
-- 0023 — estado explícito para áudio sem chave de IA
--
-- O arquivo entra e permanece privado mesmo antes de a instância configurar
-- Groq/OpenAI. Em vez de deixá-lo "queued" para sempre (ou fingir que foi
-- analisado), o job fica visivelmente aguardando a configuração.
-- =========================================================================

ALTER TYPE public.ai_job_status
  ADD VALUE IF NOT EXISTS 'waiting_configuration';
