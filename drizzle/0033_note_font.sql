-- =========================================================================
-- 0033 — A fonte de uma nota
--
-- A pessoa escolhe a fonte do documento no editor (`/nota/[id]`), e ela vale
-- para a nota — na tela e no PDF exportado —, não para o aparelho. Por isso
-- é coluna, e não `localStorage` como o zoom.
--
-- O valor é o id de uma fonte da lista curada em `lib/editor/note-fonts.ts`
-- (`default`, `literata`, …). A lista em si mora no código e o Zod do
-- `PATCH /api/notes/[id]` recusa o que não estiver nela; o CHECK abaixo só
-- trava o formato, para que acrescentar uma fonte não peça migration nova.
-- Um id que saia da lista volta a ser desenhado com a fonte padrão.
--
-- Nenhum GRANT muda: `authenticated` não tem INSERT/UPDATE em `notes`
-- desde a 0017. Toda escrita passa pela rota, com o dono vindo do token.
--
-- Idempotente.
-- =========================================================================

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS font text NOT NULL DEFAULT 'default';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notes_font_shape'
  ) THEN
    ALTER TABLE public.notes
      ADD CONSTRAINT notes_font_shape CHECK (font ~ '^[a-z0-9-]{1,32}$');
  END IF;
END $$;
