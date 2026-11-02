-- Keep removed entered deadlines as history; receipts contain safe identifiers only.
ALTER TABLE transaction_deadlines ADD COLUMN removed_at timestamptz;
--> statement-breakpoint
CREATE TABLE transaction_write_requests (
 actor_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
 action text NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT transaction_write_requests_pkey PRIMARY KEY(actor_user_id,request_id),
 CONSTRAINT transaction_write_requests_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
 CONSTRAINT transaction_write_requests_action_check CHECK (action IN ('create','edit','stage','add_deadline','edit_deadline','complete_deadline','reopen_deadline','remove_deadline'))
);
--> statement-breakpoint
CREATE INDEX transaction_write_requests_transaction_idx ON transaction_write_requests(transaction_id);
