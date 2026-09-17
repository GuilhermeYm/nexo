-- =========================================================================
-- 0021 — O fundo da lousa
--
-- A lousa deixa de ser sempre "pontos cinza sobre papel". A pessoa escolhe a
-- trama (pontos, grade, pauta, liso) e a cor da superfície (neutra ou uma das
-- seis da paleta), pelo inspetor de propriedades.
--
-- **Por que no Postgres, e não no `localStorage` como o pan e o zoom.** O
-- enquadramento é de aparelho: monitor e celular querem enquadramentos
-- diferentes, e isso é o que justifica ele viver no navegador. O fundo é a
-- cara da lousa — quem montou um quadro em papel milimetrado espera encontrar
-- papel milimetrado no celular. Mesma regra que já valeu para o fundo da
-- caixa de texto, que mora no `content` da janela e atravessa dispositivos.
--
-- **Duas colunas de texto com CHECK, e não um `appearance jsonb`.** Os
-- valores são enums pequenos e fechados, e `workspaces` ainda tem
-- INSERT/UPDATE/DELETE de tabela para `authenticated` (ver docs/SECURITY.md):
-- o CHECK é a trava que vale mesmo quando a escrita não passa pela rota. Um
-- jsonb aceitaria qualquer chave inventada pelo PostgREST. Mesmo argumento do
-- 0019 para a aparência da ligação.
--
-- A cor é **nula** por padrão, e não '0': "sem cor" é a superfície neutra que
-- acompanha os temas claro e escuro, e dois jeitos de escrever isso virariam
-- duas condições em toda leitura.
--
-- Idempotente de ponta a ponta.
-- =========================================================================

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS board_pattern text NOT NULL DEFAULT 'dots',
  ADD COLUMN IF NOT EXISTS board_tone text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_board_pattern_check'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_board_pattern_check
      CHECK (board_pattern IN ('dots', 'grid', 'lines', 'plain'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_board_tone_check'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_board_tone_check
      CHECK (board_tone IS NULL OR board_tone IN ('1', '2', '3', '4', '5', '6'));
  END IF;
END
$$;
