CREATE TABLE property_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,
  brokerage_key text NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  create_request_id uuid,
  create_payload_hash text,
  -- This is an immutable original-contact anchor, not the current association.
  default_for_contact_id uuid,
  CONSTRAINT property_lists_name_check CHECK (
    char_length(name) BETWEEN 1 AND 120 AND btrim(name)=name AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT property_lists_request_check CHECK (
    (create_request_id IS NULL AND create_payload_hash IS NULL)
    OR (create_request_id IS NOT NULL AND create_payload_hash IS NOT NULL AND create_payload_hash ~ '^[0-9a-f]{64}$')
  )
);
--> statement-breakpoint
CREATE INDEX property_lists_owner_updated_idx ON property_lists(owner_user_id,updated_at DESC,id DESC);
CREATE INDEX property_lists_contact_idx ON property_lists(contact_id);
CREATE UNIQUE INDEX property_lists_owner_request_idx ON property_lists(owner_user_id,create_request_id) WHERE create_request_id IS NOT NULL;
CREATE UNIQUE INDEX property_lists_owner_default_idx ON property_lists(owner_user_id,default_for_contact_id) WHERE default_for_contact_id IS NOT NULL;
--> statement-breakpoint
-- Retain every original association, including removed rows and their original times.
INSERT INTO property_lists(owner_user_id,brokerage_key,contact_id,name,created_at,updated_at,default_for_contact_id)
SELECT c.assigned_agent_user_id,c.brokerage_key,c.id,'Saved properties',min(p.created_at),max(greatest(p.created_at,coalesce(p.removed_at,p.created_at))),c.id
FROM contact_properties p JOIN contacts c ON c.id=p.contact_id GROUP BY c.id,c.assigned_agent_user_id,c.brokerage_key;
--> statement-breakpoint
ALTER TABLE contact_properties ADD COLUMN list_id uuid REFERENCES property_lists(id) ON DELETE RESTRICT;
UPDATE contact_properties p SET list_id=l.id FROM property_lists l WHERE l.default_for_contact_id=p.contact_id;
ALTER TABLE contact_properties ALTER COLUMN list_id SET NOT NULL;
ALTER TABLE contact_properties ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE contact_properties DROP CONSTRAINT contact_properties_contact_id_fkey;
ALTER TABLE contact_properties ADD CONSTRAINT contact_properties_contact_id_fkey FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
DROP INDEX contact_properties_live_listing_idx;
CREATE UNIQUE INDEX contact_properties_live_listing_idx ON contact_properties(list_id,dataset,listing_id) WHERE removed_at IS NULL;
CREATE INDEX contact_properties_list_created_idx ON contact_properties(list_id,created_at DESC,id DESC);
DROP TRIGGER contact_properties_canonical ON contact_properties;
--> statement-breakpoint
CREATE TRIGGER property_lists_canonical BEFORE INSERT OR UPDATE OF contact_id ON property_lists FOR EACH ROW EXECUTE FUNCTION route_contact_child_to_canonical();
--> statement-breakpoint
-- A list can belong to an administrator while linked to another agent's visible contact.
-- The association must still stay in one brokerage; access remains a service concern.
CREATE FUNCTION check_property_list_contact_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contact_book text;
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    SELECT brokerage_key INTO contact_book FROM contacts WHERE id=NEW.contact_id FOR KEY SHARE;
    IF FOUND AND contact_book<>NEW.brokerage_key THEN
      RAISE check_violation USING MESSAGE='Property list contact scope mismatch';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER property_lists_scope BEFORE INSERT OR UPDATE OF contact_id,brokerage_key ON property_lists FOR EACH ROW EXECUTE FUNCTION check_property_list_contact_scope();
--> statement-breakpoint
-- Resolve a stale merged alias before comparing with its list's canonical association.
-- Parent locks precede the list lock, matching list mutations and contact merges.
CREATE FUNCTION check_property_membership_contact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_id uuid := NEW.contact_id; next_id uuid; original_owner uuid; original_book text;
  found_owner uuid; found_book text; list_contact uuid; hop integer := 0;
BEGIN
  WHILE current_id IS NOT NULL LOOP
    SELECT assigned_agent_user_id,brokerage_key,merged_into_contact_id INTO found_owner,found_book,next_id
      FROM contacts WHERE id=current_id FOR KEY SHARE;
    IF NOT FOUND THEN EXIT; END IF;
    IF hop=0 THEN original_owner:=found_owner; original_book:=found_book;
    ELSIF found_owner<>original_owner OR found_book<>original_book THEN
      RAISE check_violation USING MESSAGE='Canonical contact scope mismatch';
    END IF;
    IF next_id IS NULL THEN EXIT; END IF;
    hop:=hop+1;
    IF hop>=32 THEN RAISE check_violation USING MESSAGE='Canonical contact chain is invalid'; END IF;
    current_id:=next_id;
  END LOOP;
  NEW.contact_id:=current_id;
  SELECT contact_id INTO list_contact FROM property_lists WHERE id=NEW.list_id FOR SHARE;
  IF NOT FOUND THEN RETURN NEW; END IF; -- The ordinary list foreign key reports this.
  IF NEW.contact_id IS DISTINCT FROM list_contact THEN
    -- Both foreign keys use SET NULL. Their actions may run in either order when
    -- a contact is deleted; the list action below synchronizes the final state.
    IF NEW.contact_id IS NULL AND list_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=list_contact) THEN RETURN NEW; END IF;
    RAISE check_violation USING MESSAGE='Property membership contact mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contact_properties_list_contact BEFORE INSERT OR UPDATE OF list_id,contact_id ON contact_properties FOR EACH ROW EXECUTE FUNCTION check_property_membership_contact();
--> statement-breakpoint
CREATE FUNCTION sync_property_list_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
    UPDATE contact_properties SET contact_id=NEW.contact_id WHERE list_id=NEW.id AND contact_id IS DISTINCT FROM NEW.contact_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER property_lists_sync_contact AFTER UPDATE OF contact_id ON property_lists FOR EACH ROW EXECUTE FUNCTION sync_property_list_contact();
