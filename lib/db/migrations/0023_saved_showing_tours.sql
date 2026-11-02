-- User-authored private plans only: no MLS content, route geometry, traffic or geocoded points.
CREATE TABLE saved_showing_tours (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,
 brokerage_key text NOT NULL,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
 source_list_id uuid NOT NULL REFERENCES property_lists(id) ON DELETE RESTRICT,
 name text NOT NULL, notes text NOT NULL DEFAULT '', starts_at timestamptz NOT NULL,
 buffer_minutes integer NOT NULL DEFAULT 10, first_property_id text NOT NULL DEFAULT 'auto',
 origin_address text NOT NULL DEFAULT '', end_mode text NOT NULL DEFAULT 'last_property', end_address text NOT NULL DEFAULT '',
 review_key text NOT NULL DEFAULT (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz, last_scheduled_at timestamptz,
 create_request_id uuid NOT NULL, create_payload_hash text NOT NULL,
 CONSTRAINT saved_showing_tours_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
 CONSTRAINT saved_showing_tours_text_check CHECK (char_length(notes)<=4000 AND char_length(origin_address)<=500 AND char_length(end_address)<=500),
 CONSTRAINT saved_showing_tours_buffer_check CHECK (buffer_minutes BETWEEN 0 AND 60),
 CONSTRAINT saved_showing_tours_first_check CHECK (first_property_id='auto' OR first_property_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 CONSTRAINT saved_showing_tours_end_check CHECK (end_mode IN ('last_property','return_to_start','address') AND (end_mode<>'address' OR char_length(btrim(end_address))>0)),
 CONSTRAINT saved_showing_tours_hash_check CHECK (review_key ~ '^[0-9a-f]{64}$' AND create_payload_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX saved_showing_tours_owner_idx ON saved_showing_tours(owner_user_id,updated_at,id);
CREATE INDEX saved_showing_tours_contact_idx ON saved_showing_tours(contact_id);
CREATE INDEX saved_showing_tours_list_idx ON saved_showing_tours(source_list_id);
CREATE UNIQUE INDEX saved_showing_tours_owner_request_idx ON saved_showing_tours(owner_user_id,create_request_id);
--> statement-breakpoint
CREATE TRIGGER saved_showing_tours_canonical BEFORE INSERT OR UPDATE OF contact_id ON saved_showing_tours FOR EACH ROW EXECUTE FUNCTION route_contact_child_to_canonical();
CREATE FUNCTION check_saved_showing_tour_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contact_book text; list_book text; list_owner uuid;
BEGIN
 SELECT brokerage_key INTO contact_book FROM contacts WHERE id=NEW.contact_id FOR KEY SHARE;
 SELECT brokerage_key,owner_user_id INTO list_book,list_owner FROM property_lists WHERE id=NEW.source_list_id FOR KEY SHARE;
 IF contact_book<>NEW.brokerage_key OR list_book<>NEW.brokerage_key OR list_owner<>NEW.owner_user_id THEN
  RAISE check_violation USING MESSAGE='Saved tour scope mismatch';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER saved_showing_tours_scope BEFORE INSERT OR UPDATE OF contact_id,source_list_id,owner_user_id,brokerage_key ON saved_showing_tours FOR EACH ROW EXECUTE FUNCTION check_saved_showing_tour_scope();
--> statement-breakpoint
CREATE TABLE saved_tour_stops (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tour_id uuid NOT NULL REFERENCES saved_showing_tours(id) ON DELETE RESTRICT,
 property_id uuid NOT NULL REFERENCES contact_properties(id) ON DELETE RESTRICT,
 position integer NOT NULL, visit_minutes integer NOT NULL, lock_time boolean NOT NULL DEFAULT false,
 linked_showing_id uuid REFERENCES showings(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT saved_tour_stops_position_key UNIQUE(tour_id,position) DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT saved_tour_stops_position_check CHECK (position BETWEEN 0 AND 7),
 CONSTRAINT saved_tour_stops_duration_check CHECK (visit_minutes BETWEEN 15 AND 240),
 CONSTRAINT saved_tour_stops_lock_check CHECK (NOT lock_time OR linked_showing_id IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX saved_tour_stops_property_idx ON saved_tour_stops(tour_id,property_id);
CREATE INDEX saved_tour_stops_showing_idx ON saved_tour_stops(linked_showing_id);
--> statement-breakpoint
CREATE TABLE saved_tour_requests (
 actor_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL, tour_id uuid NOT NULL REFERENCES saved_showing_tours(id) ON DELETE RESTRICT,
 action text NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT saved_tour_requests_pkey PRIMARY KEY(actor_user_id,request_id),
 CONSTRAINT saved_tour_requests_action_check CHECK (action IN ('edit','archive','schedule')),
 CONSTRAINT saved_tour_requests_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);
