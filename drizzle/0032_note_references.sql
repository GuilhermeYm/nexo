-- =========================================================================
-- 0032 — As referências de uma nota
--
-- Uma lista de links que a pessoa cita na nota: a página de onde tirou a
-- ideia, o artigo, o vídeo. Fica numa coluna própria, e não dentro do
-- documento do editor, por dois motivos:
--
--   1. O editor desenha a lista como um bloco à parte, sempre no fim da nota
--      e no fim do PDF exportado, com a URL inteira escrita — no papel o
--      link não é clicável, e a referência tem de sobreviver a isso.
--   2. `content_rich` é derivado para `content` e cai na busca; uma lista de
--      URLs no meio do texto puro poluiria o resumo e o `search_vector`.
--
-- Formato: `[{ "url": "https://…", "title": "…" }]`. Quem valida é o Zod do
-- `PATCH /api/notes/[id]` (http/https só, tetos de tamanho); o CHECK abaixo é
-- a segunda trava, que vale também para quem escreve pelo `postgres`.
--
-- Nenhum GRANT muda: `authenticated` não tem INSERT/UPDATE em `notes`
-- desde a 0017. Toda escrita passa pela rota, com o dono vindo do token.
--
-- Idempotente.
-- =========================================================================

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS reference_links jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notes_reference_links_shape'
  ) THEN
    ALTER TABLE public.notes
      ADD CONSTRAINT notes_reference_links_shape CHECK (
        jsonb_typeof(reference_links) = 'array'
        AND jsonb_array_length(reference_links) <= 50
      );
  END IF;
END $$;
