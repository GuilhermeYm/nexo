-- =========================================================================
-- 0008 — Conteúdo rico das notas
--
-- Adiciona `notes.content_rich`, o documento do editor (formato TipTap /
-- ProseMirror).
--
-- Por que uma coluna nova em vez de trocar o tipo de `content`:
--
--   `notes.search_vector` é uma coluna GERADA sobre `title || content` (ver
--   0003). Guardar HTML ou JSON em `content` faria o índice de busca engolir
--   marcação — a busca passaria a casar com "paragraph", "attrs" e "<p>" — e
--   os resumos de Recentes e do painel da lousa passariam a exibir tag crua.
--
-- Então a divisão é: `content` é a **projeção em texto puro**, autoritativa
-- para busca e resumo, e `content_rich` é o documento com a estrutura. Quem
-- mantém as duas em sincronia é o servidor, que deriva o texto do JSON a
-- cada salvamento — nunca o cliente.
--
-- Notas antigas e as criadas pela IA ficam com `content_rich` nulo, e o
-- editor monta o documento a partir do texto na primeira abertura. Nenhuma
-- linha existente precisa ser migrada.
--
-- Idempotente: rodar de novo não quebra nem duplica nada.
-- =========================================================================

ALTER TABLE notes ADD COLUMN IF NOT EXISTS content_rich jsonb;

COMMENT ON COLUMN notes.content_rich IS
  'Documento do editor (TipTap/ProseMirror). O texto puro equivalente vive em notes.content, que é o que alimenta search_vector e os resumos.';
