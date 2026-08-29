-- Aplicada no Supabase via MCP (apply_migration) em 2026-08-22.
-- Bucket privado para documentos/áudios dos usuários (imagens têm bucket próprio).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'files',
  'files',
  false,
  26214400, -- 25MB
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'audio/mpeg',
    'audio/wav',
    'audio/mp4',
    'audio/x-m4a'
  ]
);

-- Policies: mesmo padrão do bucket images — cada usuário só acessa a pasta {auth.uid()}/.
CREATE POLICY "Files: upload to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'files'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

CREATE POLICY "Files: read own"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'files'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

CREATE POLICY "Files: update own"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'files'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

CREATE POLICY "Files: delete own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'files'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

-- Busca full-text em português sobre título + conteúdo das notas.
ALTER TABLE notes
ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
  to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(content, ''))
) STORED;

CREATE INDEX notes_search_vector_idx ON notes USING GIN (search_vector);
