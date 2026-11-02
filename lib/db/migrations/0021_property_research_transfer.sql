-- Private user research belongs to a saved membership, independently in each list.
ALTER TABLE contact_properties
  ADD COLUMN notes text NOT NULL DEFAULT '',
  ADD COLUMN review_status text NOT NULL DEFAULT 'to_review',
  ADD COLUMN updated_at timestamptz;
--> statement-breakpoint
-- Existing memberships begin at their own creation revision, not migration time.
UPDATE contact_properties SET updated_at=created_at;
ALTER TABLE contact_properties ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE contact_properties ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE contact_properties ADD CONSTRAINT contact_properties_notes_check CHECK (char_length(notes)<=5000);
ALTER TABLE contact_properties ADD CONSTRAINT contact_properties_review_status_check CHECK (review_status IN ('to_review','shortlisted','ruled_out'));
--> statement-breakpoint
-- Reserve the receipt and transfer writes in one transaction. The service rechecks
-- both private list scopes before replay; no note text is retained in a receipt.
CREATE TABLE property_transfer_requests (
  actor_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  source_list_id uuid NOT NULL REFERENCES property_lists(id) ON DELETE RESTRICT,
  target_list_id uuid NOT NULL REFERENCES property_lists(id) ON DELETE RESTRICT,
  source_property_id uuid NOT NULL REFERENCES contact_properties(id) ON DELETE RESTRICT,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_transfer_requests_pkey PRIMARY KEY(actor_user_id,request_id),
  CONSTRAINT property_transfer_requests_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT property_transfer_requests_lists_check CHECK (source_list_id<>target_list_id)
);
