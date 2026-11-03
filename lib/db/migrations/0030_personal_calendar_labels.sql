-- Private personal records and private color overlays. Existing source rows remain authoritative.
CREATE TABLE calendar_labels (
 owner_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT, brokerage_key text NOT NULL,
 id text NOT NULL, name text NOT NULL, color text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
 PRIMARY KEY(owner_user_id,brokerage_key,id),
 CONSTRAINT calendar_labels_name_check CHECK(char_length(btrim(name)) BETWEEN 1 AND 60),
 CONSTRAINT calendar_labels_color_check CHECK(color IN ('red','amber','green','blue','purple','teal','slate','pink')),
 CONSTRAINT calendar_labels_id_check CHECK(id IN ('urgent','important','low-priority','personal') OR id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
CREATE INDEX calendar_labels_owner_active_idx ON calendar_labels(owner_user_id,brokerage_key,archived_at);
--> statement-breakpoint
CREATE TABLE personal_calendar_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,
 brokerage_key text NOT NULL, title text NOT NULL, notes text NOT NULL DEFAULT '', location text NOT NULL DEFAULT '',
 day date NOT NULL, all_day boolean NOT NULL, starts_at timestamptz, ends_at timestamptz, blocks_time boolean NOT NULL DEFAULT false, label_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), cancelled_at timestamptz,
 FOREIGN KEY(owner_user_id,brokerage_key,label_id) REFERENCES calendar_labels(owner_user_id,brokerage_key,id) ON DELETE RESTRICT,
 CONSTRAINT personal_calendar_items_text_check CHECK(char_length(btrim(title)) BETWEEN 1 AND 200 AND char_length(notes)<=5000 AND char_length(location)<=500),
 CONSTRAINT personal_calendar_items_time_check CHECK((all_day AND starts_at IS NULL AND ends_at IS NULL AND NOT blocks_time) OR (NOT all_day AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at>starts_at AND ends_at-starts_at<=interval '7 days' AND (starts_at AT TIME ZONE 'America/New_York')::date=day))
);
CREATE INDEX personal_calendar_items_owner_day_idx ON personal_calendar_items(owner_user_id,brokerage_key,day);
CREATE INDEX personal_calendar_items_owner_time_idx ON personal_calendar_items(owner_user_id,brokerage_key,starts_at);
--> statement-breakpoint
CREATE TABLE calendar_item_annotations (
 owner_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT, brokerage_key text NOT NULL,
 item_id text NOT NULL, kind text NOT NULL, source_id uuid NOT NULL, label_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_user_id,brokerage_key,item_id,kind,source_id),
 FOREIGN KEY(owner_user_id,brokerage_key,label_id) REFERENCES calendar_labels(owner_user_id,brokerage_key,id) ON DELETE RESTRICT,
 CONSTRAINT calendar_annotations_kind_check CHECK(kind IN ('showing','tour','transaction_deadline','next_action','reminder')),
 CONSTRAINT calendar_annotations_item_check CHECK(char_length(item_id) BETWEEN 1 AND 100)
);
CREATE INDEX calendar_annotations_source_idx ON calendar_item_annotations(owner_user_id,brokerage_key,kind,source_id);
--> statement-breakpoint
CREATE TABLE calendar_write_requests (
 actor_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT, request_id uuid NOT NULL, brokerage_key text NOT NULL,
 action text NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_user_id,request_id),
 CONSTRAINT calendar_requests_action_check CHECK(action IN ('create_item','update_item','cancel_item','create_label','update_label','archive_label','annotate')),
 CONSTRAINT calendar_requests_hash_check CHECK(payload_hash ~ '^[0-9a-f]{64}$')
);
