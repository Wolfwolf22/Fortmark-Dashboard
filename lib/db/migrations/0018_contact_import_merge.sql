ALTER TABLE contacts
  ADD COLUMN merged_into_contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT,
  ADD COLUMN merged_at timestamptz;
--> statement-breakpoint
ALTER TABLE contacts ADD CONSTRAINT contacts_merge_pointer_check CHECK (
  (merged_into_contact_id IS NULL AND merged_at IS NULL)
  OR (merged_into_contact_id IS NOT NULL AND merged_at IS NOT NULL AND merged_into_contact_id <> id AND stage='archived')
);
--> statement-breakpoint
CREATE INDEX contacts_merged_into_idx ON contacts(merged_into_contact_id);
--> statement-breakpoint
CREATE TABLE contact_import_requests (
  actor_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL CONSTRAINT contact_import_requests_hash_check CHECK (length(payload_hash) = 64),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id,request_id)
);
--> statement-breakpoint
CREATE TABLE contact_merge_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,
  keeper_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL CONSTRAINT contact_merge_requests_hash_check CHECK (length(payload_hash) = 64),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX contact_merge_requests_actor_request_idx ON contact_merge_requests(actor_user_id,request_id);
--> statement-breakpoint
-- Serialize child writes with merges, then keep them on the existing owner's canonical record.
CREATE FUNCTION route_contact_child_to_canonical() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_id uuid := NEW.contact_id; next_id uuid; original_owner uuid; original_book text;
  found_owner uuid; found_book text; hop integer := 0;
BEGIN
  IF current_id IS NULL THEN RETURN NEW; END IF;
  LOOP
    SELECT assigned_agent_user_id,brokerage_key,merged_into_contact_id INTO found_owner,found_book,next_id
      FROM contacts WHERE id=current_id FOR KEY SHARE;
    IF NOT FOUND THEN NEW.contact_id := current_id; RETURN NEW; END IF;
    IF hop=0 THEN original_owner:=found_owner; original_book:=found_book;
    ELSIF found_owner<>original_owner OR found_book<>original_book THEN
      RAISE check_violation USING MESSAGE='Canonical contact scope mismatch';
    END IF;
    IF next_id IS NULL THEN NEW.contact_id:=current_id; RETURN NEW; END IF;
    hop:=hop+1;
    IF hop>=32 THEN RAISE check_violation USING MESSAGE='Canonical contact chain is invalid'; END IF;
    current_id:=next_id;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE TRIGGER contact_notes_canonical BEFORE INSERT OR UPDATE OF contact_id ON contact_notes FOR EACH ROW EXECUTE FUNCTION route_contact_child_to_canonical();
CREATE TRIGGER contact_needs_canonical BEFORE INSERT OR UPDATE OF contact_id ON contact_needs FOR EACH ROW EXECUTE FUNCTION route_contact_child_to_canonical();
CREATE TRIGGER contact_activities_canonical BEFORE INSERT OR UPDATE OF contact_id ON contact_activities FOR EACH ROW EXECUTE FUNCTION route_contact_child_to_canonical();
CREATE TRIGGER contact_opportunities_canonical BEFORE INSERT OR UPDATE OF contact_id ON contact_opportunities FOR EACH ROW EXECUTE FUNCTION route_contact_child_to_canonical();
CREATE TRIGGER transaction_parties_canonical BEFORE INSERT OR UPDATE OF contact_id ON transaction_parties FOR EACH ROW EXECUTE FUNCTION route_contact_child_to_canonical();
