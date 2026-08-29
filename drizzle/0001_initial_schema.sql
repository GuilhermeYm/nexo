-- Dropar tabela legada que conflita com o auth.users do Supabase
DROP TABLE IF EXISTS public."Profiles";

-- Enums
CREATE TYPE subscription_status AS ENUM (
  'trialing', 'active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'unpaid', 'paused'
);

CREATE TYPE plan AS ENUM ('free', 'pro', 'enterprise');

CREATE TYPE note_type AS ENUM ('note', 'task', 'journal', 'idea', 'meeting', 'document');

CREATE TYPE note_source AS ENUM ('user', 'ai');

CREATE TYPE note_status AS ENUM ('active', 'archived', 'deleted');

CREATE TYPE attachment_type AS ENUM ('image', 'audio', 'video', 'pdf', 'document', 'other');

-- Trigger helper para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Perfis: estende auth.users com dados de assinatura e preferências
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  subscription_status subscription_status DEFAULT 'trialing',
  stripe_customer_id text,
  stripe_subscription_id text,
  plan plan DEFAULT 'free' NOT NULL,
  current_period_end timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX profiles_stripe_customer_id_idx ON profiles(stripe_customer_id);

CREATE TRIGGER profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Workspaces: espaços de trabalho do usuário
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  icon text,
  color text,
  is_default boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX workspaces_user_id_idx ON workspaces(user_id);

CREATE TRIGGER workspaces_updated_at
BEFORE UPDATE ON workspaces
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Notes: conteúdo criado pelo usuário ou pela IA
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  parent_id uuid REFERENCES notes(id) ON DELETE SET NULL,
  title text NOT NULL,
  content text,
  type note_type DEFAULT 'note' NOT NULL,
  source note_source DEFAULT 'user' NOT NULL,
  status note_status DEFAULT 'active' NOT NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX notes_user_id_idx ON notes(user_id);
CREATE INDEX notes_workspace_id_idx ON notes(workspace_id);
CREATE INDEX notes_parent_id_idx ON notes(parent_id);
CREATE INDEX notes_status_idx ON notes(status);

CREATE TRIGGER notes_updated_at
BEFORE UPDATE ON notes
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Tags: organização por tags
CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX tags_user_id_idx ON tags(user_id);
CREATE UNIQUE INDEX tags_user_id_name_idx ON tags(user_id, name);

-- Relação N:N entre notas e tags
CREATE TABLE note_tags (
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX note_tags_note_id_idx ON note_tags(note_id);
CREATE INDEX note_tags_tag_id_idx ON note_tags(tag_id);

-- Attachments: metadados de arquivos no Storage
CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id uuid REFERENCES notes(id) ON DELETE SET NULL,
  type attachment_type DEFAULT 'other' NOT NULL,
  storage_path text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint,
  duration_seconds integer,
  metadata jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX attachments_user_id_idx ON attachments(user_id);
CREATE INDEX attachments_note_id_idx ON attachments(note_id);

-- Audit logs: auditoria de ações sensíveis
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  old_data jsonb,
  new_data jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX audit_logs_record_id_idx ON audit_logs(record_id);
CREATE INDEX audit_logs_created_at_idx ON audit_logs(created_at);

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Profiles: cada usuário vê/edita apenas o próprio perfil
CREATE POLICY "Users read own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Workspaces
CREATE POLICY "Users manage own workspaces" ON workspaces
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Notes
CREATE POLICY "Users manage own notes" ON notes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Tags
CREATE POLICY "Users manage own tags" ON tags
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Note tags: só pode vincular tags em notas próprias
CREATE POLICY "Users manage tags of own notes" ON note_tags
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM notes WHERE notes.id = note_tags.note_id AND notes.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM notes WHERE notes.id = note_tags.note_id AND notes.user_id = auth.uid()
    ) AND
    EXISTS (
      SELECT 1 FROM tags WHERE tags.id = note_tags.tag_id AND tags.user_id = auth.uid()
    )
  );

-- Attachments
CREATE POLICY "Users manage own attachments" ON attachments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Audit logs: usuários só leem próprios logs; inserts via service_role
CREATE POLICY "Users read own audit logs" ON audit_logs
  FOR SELECT USING (auth.uid() = user_id);
