-- Private appointments store MLS identity only; licensed display data remains in the feed.
CREATE TABLE showings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,
  brokerage_key text NOT NULL,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  source_property_id uuid NOT NULL REFERENCES contact_properties(id) ON DELETE RESTRICT,
  dataset text NOT NULL,
  listing_id text NOT NULL,
  mls_number text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  meeting_details text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'scheduled',
  feedback_likes text NOT NULL DEFAULT '',
  feedback_concerns text NOT NULL DEFAULT '',
  feedback_summary text NOT NULL DEFAULT '',
  visited_at timestamptz,
  cancel_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  create_request_id uuid NOT NULL,
  create_payload_hash text NOT NULL,
  CONSTRAINT showings_dataset_check CHECK (dataset ~ '^[A-Za-z0-9_-]{1,80}$'),
  CONSTRAINT showings_listing_id_check CHECK (char_length(listing_id) BETWEEN 1 AND 256 AND btrim(listing_id)=listing_id AND listing_id !~ '[[:cntrl:]]'),
  CONSTRAINT showings_mls_number_check CHECK (mls_number ~ '^[A-Z0-9][A-Z0-9-]{0,39}$' AND mls_number ~ '[0-9]'),
  CONSTRAINT showings_duration_check CHECK (ends_at-starts_at BETWEEN interval '15 minutes' AND interval '240 minutes'),
  CONSTRAINT showings_status_check CHECK (status IN ('scheduled','completed','cancelled')),
  CONSTRAINT showings_text_bounds_check CHECK (
    char_length(meeting_details)<=1000 AND char_length(notes)<=2000
    AND char_length(feedback_likes)<=2000 AND char_length(feedback_concerns)<=2000
    AND char_length(feedback_summary)<=2000 AND char_length(cancel_reason)<=1000
  ),
  CONSTRAINT showings_completion_check CHECK (
    (status='completed' AND visited_at IS NOT NULL) OR (status<>'completed' AND visited_at IS NULL)
  ),
  CONSTRAINT showings_cancellation_check CHECK (
    (status='cancelled' AND cancel_reason ~ '[^[:space:]]') OR (status<>'cancelled' AND cancel_reason='')
  ),
  CONSTRAINT showings_create_hash_check CHECK (create_payload_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX showings_owner_starts_idx ON showings(owner_user_id,starts_at,id);
CREATE INDEX showings_contact_idx ON showings(contact_id);
CREATE INDEX showings_source_property_idx ON showings(source_property_id);
CREATE UNIQUE INDEX showings_owner_request_idx ON showings(owner_user_id,create_request_id);
--> statement-breakpoint
CREATE TRIGGER showings_canonical BEFORE INSERT OR UPDATE OF contact_id ON showings FOR EACH ROW EXECUTE FUNCTION route_contact_child_to_canonical();
--> statement-breakpoint
-- An administrator may own an appointment for another agent's visible contact.
-- Contact and appointment must still stay inside the same brokerage.
CREATE FUNCTION check_showing_contact_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contact_book text;
BEGIN
  SELECT brokerage_key INTO contact_book FROM contacts WHERE id=NEW.contact_id FOR KEY SHARE;
  IF FOUND AND contact_book<>NEW.brokerage_key THEN
    RAISE check_violation USING MESSAGE='Showing contact scope mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER showings_scope BEFORE INSERT OR UPDATE OF contact_id,brokerage_key ON showings FOR EACH ROW EXECUTE FUNCTION check_showing_contact_scope();
--> statement-breakpoint
CREATE TABLE showing_mutation_requests (
  actor_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  showing_id uuid NOT NULL REFERENCES showings(id) ON DELETE RESTRICT,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showing_mutation_requests_pkey PRIMARY KEY(actor_user_id,request_id),
  CONSTRAINT showing_mutation_requests_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX showing_mutation_requests_showing_idx ON showing_mutation_requests(showing_id);
