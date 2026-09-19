-- As marcas são escritas somente pelas rotas autenticadas. SELECT fica para
-- o Realtime; escrita direta pelo PostgREST burlaria rate limit e teto por
-- lousa, mesmo com RLS mantendo o isolamento entre pessoas.
REVOKE INSERT, UPDATE, DELETE ON public.workspace_board_marks FROM authenticated;
