-- Contact files and recoverable deletion. Keep every existing contact/child identifier.
ALTER TABLE contacts ADD COLUMN deleted_at timestamptz;
ALTER TABLE contacts ADD COLUMN deleted_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL;
CREATE INDEX contacts_deleted_idx ON contacts(brokerage_key,assigned_agent_user_id,deleted_at);
--> statement-breakpoint
CREATE TABLE contact_engagement_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
 storage_path text NOT NULL, filename text NOT NULL, content_type text NOT NULL,
 size_bytes integer NOT NULL, sha256 text NOT NULL, uploaded_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), removed_at timestamptz,
 CONSTRAINT contact_engagement_files_type_check CHECK(content_type='application/pdf'),
 CONSTRAINT contact_engagement_files_size_check CHECK(size_bytes BETWEEN 1 AND 4194304),
 CONSTRAINT contact_engagement_files_filename_check CHECK(char_length(filename) BETWEEN 1 AND 180),
 CONSTRAINT contact_engagement_files_hash_check CHECK(sha256 ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX contact_engagement_files_path_idx ON contact_engagement_files(storage_path);
CREATE UNIQUE INDEX contact_engagement_files_active_idx ON contact_engagement_files(contact_id) WHERE removed_at IS NULL;
CREATE INDEX contact_engagement_files_contact_idx ON contact_engagement_files(contact_id,created_at);
--> statement-breakpoint
CREATE TABLE contact_lifecycle_requests (
 actor_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT, request_id uuid NOT NULL,
 brokerage_key text NOT NULL, contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
 action text NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_user_id,request_id),
 CONSTRAINT contact_lifecycle_requests_action_check CHECK(action IN ('delete','restore','upload_engagement','remove_engagement')),
 CONSTRAINT contact_lifecycle_requests_hash_check CHECK(payload_hash ~ '^[0-9a-f]{64}$')
);
