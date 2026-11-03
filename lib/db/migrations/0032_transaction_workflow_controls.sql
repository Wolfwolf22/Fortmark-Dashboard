-- Proposed transaction portion of the next reviewed migration. Root owns numbering/journal.
ALTER TABLE transactions ADD COLUMN deleted_at timestamptz;
ALTER TABLE transactions ADD COLUMN deleted_reason text;
ALTER TABLE transactions ADD CONSTRAINT transactions_deleted_terminal_check CHECK(deleted_at IS NULL OR stage IN ('closed','cancelled','fell_through'));
ALTER TABLE transactions ADD COLUMN listing_plan jsonb NOT NULL DEFAULT '{"goLiveDate":null,"expirationDate":null,"status":"draft","reason":null}'::jsonb;
ALTER TABLE transaction_checklist_items ADD COLUMN help_text text NOT NULL DEFAULT '';
ALTER TABLE transaction_write_requests DROP CONSTRAINT transaction_write_requests_action_check;
ALTER TABLE transaction_write_requests ADD CONSTRAINT transaction_write_requests_action_check CHECK(action IN ('create','edit','stage','add_deadline','edit_deadline','complete_deadline','reopen_deadline','remove_deadline','complete_checklist','reopen_checklist','upload_attachment','remove_attachment','set_attachment_requirement','set_vendor','edit_vendor_details','upload_vendor_attachment','remove_vendor_attachment','link_property','unlink_property','link_tour','unlink_tour','workflow'));
CREATE TABLE transaction_private_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
 author_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),removed_at timestamptz,
 CONSTRAINT transaction_private_notes_body_check CHECK(char_length(btrim(body)) BETWEEN 1 AND 5000)
);
CREATE INDEX transaction_private_notes_file_idx ON transaction_private_notes(transaction_id,created_at);
CREATE TABLE transaction_open_houses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,attendance integer,notes text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'planned',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),removed_at timestamptz,
 CONSTRAINT transaction_open_houses_values_check CHECK(ends_at>starts_at AND ends_at<=starts_at+interval '1 day' AND (attendance IS NULL OR attendance BETWEEN 0 AND 100000) AND status IN ('planned','completed','cancelled') AND char_length(notes)<=5000)
);
CREATE INDEX transaction_open_houses_file_idx ON transaction_open_houses(transaction_id,starts_at);
CREATE TABLE transaction_reopen_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
 requested_by_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,reason text NOT NULL,status text NOT NULL DEFAULT 'pending',
 decided_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE RESTRICT,decision_reason text,previous_closed_date date,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT transaction_reopen_requests_values_check CHECK(char_length(btrim(reason)) BETWEEN 1 AND 2000 AND status IN ('pending','approved','denied') AND (status='pending' OR (decided_by_user_id IS NOT NULL AND decision_reason IS NOT NULL AND char_length(btrim(decision_reason)) BETWEEN 1 AND 2000)))
);
CREATE INDEX transaction_reopen_requests_file_idx ON transaction_reopen_requests(transaction_id,created_at);
CREATE UNIQUE INDEX transaction_reopen_requests_pending_idx ON transaction_reopen_requests(transaction_id) WHERE status='pending';
