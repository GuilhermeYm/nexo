-- Aplicada no Supabase via MCP (apply_migration) em 2026-08-22.
-- Cria perfil + workspace default automaticamente a cada novo usuário do auth.
-- security definer necessário: profiles não tem policy de INSERT para usuários.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name');

  INSERT INTO public.workspaces (user_id, name, is_default)
  VALUES (NEW.id, 'Pessoal', true);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
