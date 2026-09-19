-- Caneta e formas geométricas da lousa. Cada gesto vira uma linha: isso
-- mantém conflitos entre dispositivos isolados e permite apagar sem regravar
-- um blob contendo a lousa inteira.
CREATE TABLE public.workspace_board_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  kind text NOT NULL,
  points jsonb NOT NULL DEFAULT '[]'::jsonb,
  x integer NOT NULL,
  y integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  tone text NOT NULL DEFAULT 'default',
  weight integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_board_marks_workspace_fk
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES public.workspaces (id, user_id) ON DELETE CASCADE,
  CONSTRAINT workspace_board_marks_sane CHECK (
    kind IN ('pen', 'rectangle', 'ellipse', 'diamond')
    AND tone IN ('default', '1', '2', '3', '4', '5', '6')
    AND weight BETWEEN 1 AND 12
    AND x BETWEEN -200000 AND 200000
    AND y BETWEEN -200000 AND 200000
    AND width BETWEEN 1 AND 400000
    AND height BETWEEN 1 AND 400000
    AND jsonb_typeof(points) = 'array'
    AND jsonb_array_length(points) <= 2048
  )
);

CREATE INDEX workspace_board_marks_workspace_id_idx
  ON public.workspace_board_marks (workspace_id);
CREATE INDEX workspace_board_marks_user_id_idx
  ON public.workspace_board_marks (user_id);

ALTER TABLE public.workspace_board_marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own board marks" ON public.workspace_board_marks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own board marks" ON public.workspace_board_marks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own board marks" ON public.workspace_board_marks
  FOR DELETE USING (auth.uid() = user_id);

REVOKE ALL ON public.workspace_board_marks FROM anon;
REVOKE ALL ON public.workspace_board_marks FROM authenticated;
GRANT SELECT (id, user_id, workspace_id, kind, points, x, y, width, height, tone, weight, created_at)
  ON public.workspace_board_marks TO authenticated;
GRANT INSERT (id, user_id, workspace_id, kind, points, x, y, width, height, tone, weight)
  ON public.workspace_board_marks TO authenticated;
GRANT DELETE ON public.workspace_board_marks TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_board_marks;
