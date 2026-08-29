-- =========================================================================
-- 0009 — Anexos como janela da lousa
--
-- Até aqui a lousa só sabia mostrar o que a IA *escreveu sobre* o arquivo: a
-- nota com título, resumo e tags. O arquivo em si — o PDF, o áudio — ficava
-- no Storage, sem porta de entrada. Esta migration abre a porta.
--
-- A janela aponta para `attachments`, e não para a nota do arquivo, de
-- propósito: assim um anexo pode ser aberto sozinho, e um dia um arquivo sem
-- nota também terá onde aparecer.
--
-- Roda em duas partes. O Postgres não deixa **usar** um rótulo de enum na
-- mesma transação em que ele foi criado, e a constraint da parte 2 usa
-- 'attachment'. O marcador abaixo separa as duas.
-- =========================================================================

ALTER TYPE workspace_window_kind ADD VALUE IF NOT EXISTS 'attachment';

-- @separate-transaction

-- ----------------------------------------------------------------------
-- Alvo da chave estrangeira composta, o mesmo padrão de 0007: as duas
-- pontas precisam ser do mesmo dono para a linha entrar.
-- ----------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attachments_id_user_id_key'
  ) THEN
    ALTER TABLE attachments
      ADD CONSTRAINT attachments_id_user_id_key UNIQUE (id, user_id);
  END IF;
END
$$;

ALTER TABLE workspace_windows
  ADD COLUMN IF NOT EXISTS attachment_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_windows_attachment_fk'
  ) THEN
    ALTER TABLE workspace_windows
      ADD CONSTRAINT workspace_windows_attachment_fk
      FOREIGN KEY (attachment_id, user_id)
      REFERENCES attachments (id, user_id) ON DELETE CASCADE;
  END IF;
END
$$;

-- Cada tipo de janela aponta para exatamente o que lhe cabe: nota tem nota,
-- anexo tem anexo, post-it e caixa de texto não apontam para nada. Sem isto,
-- um 'sticky' com attachment_id entraria e a leitura teria que decidir qual
-- conteúdo vale.
ALTER TABLE workspace_windows
  DROP CONSTRAINT IF EXISTS workspace_windows_kind_matches_note;

ALTER TABLE workspace_windows
  DROP CONSTRAINT IF EXISTS workspace_windows_kind_matches_target;

ALTER TABLE workspace_windows
  ADD CONSTRAINT workspace_windows_kind_matches_target
  CHECK (
    (kind = 'note') = (note_id IS NOT NULL)
    AND (kind = 'attachment') = (attachment_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS workspace_windows_attachment_id_idx
  ON workspace_windows (attachment_id);

-- O mesmo arquivo não abre duas vezes na mesma lousa. Nulos não colidem entre
-- si no Postgres, então as janelas que não são anexo passam à vontade.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_windows_workspace_attachment_idx
  ON workspace_windows (workspace_id, attachment_id);
