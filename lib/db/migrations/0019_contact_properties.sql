-- Store only a private reference, not a duplicate of licensed MLS display data.
CREATE TABLE contact_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  dataset text NOT NULL,
  listing_id text NOT NULL,
  mls_number text NOT NULL,
  created_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  CONSTRAINT contact_properties_dataset_check CHECK (dataset ~ '^[A-Za-z0-9_-]{1,80}$'),
  CONSTRAINT contact_properties_listing_id_check CHECK (
    char_length(listing_id) BETWEEN 1 AND 256 AND btrim(listing_id) = listing_id AND listing_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT contact_properties_mls_number_check CHECK (
    mls_number ~ '^[A-Z0-9][A-Z0-9-]{0,39}$' AND mls_number ~ '[0-9]'
  )
);
--> statement-breakpoint
CREATE INDEX contact_properties_contact_created_idx ON contact_properties(contact_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX contact_properties_live_listing_idx ON contact_properties(contact_id,dataset,listing_id) WHERE removed_at IS NULL;
--> statement-breakpoint
-- Late writes serialize with merges and retain the owner's canonical contact.
CREATE TRIGGER contact_properties_canonical BEFORE INSERT OR UPDATE OF contact_id ON contact_properties FOR EACH ROW EXECUTE FUNCTION route_contact_child_to_canonical();
