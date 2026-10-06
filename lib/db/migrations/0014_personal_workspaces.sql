CREATE TABLE IF NOT EXISTS personal_workspaces (
 owner_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
 namespace text NOT NULL CHECK (namespace IN ('dashboard-layout', 'competitive-edge')),
 data jsonb NOT NULL DEFAULT '{}'::jsonb,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (owner_user_id, namespace),
 CHECK (jsonb_typeof(data) = 'object')
);
