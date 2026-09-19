-- Imagens entram como anexo, no mesmo bucket `files` dos documentos e áudios.
--
-- Por que não o bucket `images` (0001): nenhuma rota lê ou grava nele, o teto
-- dele é de 5 MB, e toda rota que assina, apaga ou recomeça a conta usa
-- `files` fixo. Um segundo bucket obrigaria cada uma a descobrir onde o
-- objeto mora — uma coluna nova em `attachments` e quatro lugares para
-- esquecer. As policies de `files` (0003) já prendem cada pessoa à própria
-- pasta, e valem igual para imagem.
--
-- SVG fica de fora de propósito: é XML com script, e servido do Storage
-- vira XSS na origem do Supabase. HEIC também: nenhum navegador fora o
-- Safari o desenha, e os modelos de visão não o aceitam.
--
-- Idempotente: a lista é somada e deduplicada, não substituída — rodar de
-- novo não muda nada, e uma instância que já liberou outro tipo não o perde.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY(
  SELECT DISTINCT unnest(
    coalesce(allowed_mime_types, ARRAY[]::text[])
    || ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  )
  ORDER BY 1
)
WHERE id = 'files';
