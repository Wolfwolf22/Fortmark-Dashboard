-- Private checklist evidence, administrator attachment defaults, and approved vendor selections.
ALTER TABLE transaction_checklist_items ADD COLUMN attachment_required boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE transaction_checklist_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
 checklist_item_id uuid NOT NULL REFERENCES transaction_checklist_items(id) ON DELETE RESTRICT,
 storage_path text NOT NULL, filename text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, sha256 text NOT NULL,
 uploaded_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), removed_at timestamptz,
 CONSTRAINT transaction_checklist_attachments_size_check CHECK(size_bytes BETWEEN 1 AND 4194304),
 CONSTRAINT transaction_checklist_attachments_type_check CHECK(content_type IN ('application/pdf','image/jpeg','image/png')),
 CONSTRAINT transaction_checklist_attachments_hash_check CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 CONSTRAINT transaction_checklist_attachments_filename_check CHECK(char_length(filename) BETWEEN 1 AND 180)
);
CREATE UNIQUE INDEX transaction_checklist_attachments_path_idx ON transaction_checklist_attachments(storage_path);
CREATE INDEX transaction_checklist_attachments_item_idx ON transaction_checklist_attachments(transaction_id,checklist_item_id);
--> statement-breakpoint
CREATE TABLE transaction_checklist_template_settings (
 brokerage_key text NOT NULL, template_key text NOT NULL, attachment_required boolean NOT NULL,
 updated_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(brokerage_key,template_key)
);
CREATE TABLE transaction_setup_write_requests (
 actor_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT, request_id uuid NOT NULL, brokerage_key text NOT NULL,
 action text NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_user_id,request_id),
 CONSTRAINT transaction_setup_requests_action_check CHECK(action='checklist_default'),
 CONSTRAINT transaction_setup_requests_hash_check CHECK(payload_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE brokerage_vendors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brokerage_key text NOT NULL, name text NOT NULL, company text, email text, phone text,
 categories text[] NOT NULL, approved boolean NOT NULL DEFAULT false,
 created_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL, updated_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT brokerage_vendors_name_check CHECK(char_length(btrim(name)) BETWEEN 1 AND 160),
 CONSTRAINT brokerage_vendors_categories_check CHECK(cardinality(categories) BETWEEN 1 AND 8 AND categories <@ ARRAY['inspector','mortgage','appraiser','termite','insurance','title','attorney','other']::text[])
);
CREATE INDEX brokerage_vendors_book_idx ON brokerage_vendors(brokerage_key,approved);
CREATE TABLE brokerage_vendor_write_requests (
 actor_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT, request_id uuid NOT NULL, brokerage_key text NOT NULL,
 vendor_id uuid NOT NULL REFERENCES brokerage_vendors(id) ON DELETE RESTRICT, action text NOT NULL, payload_hash text NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_user_id,request_id),
 CONSTRAINT brokerage_vendor_requests_action_check CHECK(action IN ('create','edit')),
 CONSTRAINT brokerage_vendor_requests_hash_check CHECK(payload_hash ~ '^[0-9a-f]{64}$')
);
CREATE TABLE transaction_vendor_selections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
 role text NOT NULL, status text NOT NULL, vendor_id uuid REFERENCES brokerage_vendors(id) ON DELETE RESTRICT,
 vendor_name text, company text, email text, phone text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT transaction_vendor_selections_role_check CHECK(role IN ('inspector','mortgage','appraiser','termite','insurance','title','attorney','other')),
 CONSTRAINT transaction_vendor_selections_status_check CHECK(status IN ('selected','not_needed','unset')),
 CONSTRAINT transaction_vendor_selections_vendor_check CHECK((status='selected' AND vendor_id IS NOT NULL AND vendor_name IS NOT NULL) OR (status<>'selected' AND vendor_id IS NULL AND vendor_name IS NULL AND company IS NULL AND email IS NULL AND phone IS NULL))
);
CREATE UNIQUE INDEX transaction_vendor_selections_role_idx ON transaction_vendor_selections(transaction_id,role);
--> statement-breakpoint
ALTER TABLE transaction_write_requests DROP CONSTRAINT transaction_write_requests_action_check;
ALTER TABLE transaction_write_requests ADD CONSTRAINT transaction_write_requests_action_check CHECK(action IN ('create','edit','stage','add_deadline','edit_deadline','complete_deadline','reopen_deadline','remove_deadline','complete_checklist','reopen_checklist','upload_attachment','remove_attachment','set_attachment_requirement','set_vendor'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION seed_transaction_checklist_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO transaction_checklist_items(transaction_id,template_key,label,stage,required,sort_order,attachment_required,created_at,updated_at)
 SELECT NEW.id,v.template_key,v.label,v.stage::transaction_stage,v.required,v.sort_order,coalesce((SELECT s.attachment_required FROM transaction_checklist_template_settings s WHERE s.brokerage_key=NEW.brokerage_key AND s.template_key=v.template_key),false),NEW.created_at,NEW.updated_at
 FROM (VALUES
  ('opportunity.client','Confirm the client and representation side','opportunity',true,0),
  ('opportunity.scope','Record the property and transaction scope','opportunity',true,1),
  ('offer.terms','Record the reviewed offer terms','offer',true,2),
  ('offer.decision','Record the client’s decision on the offer','offer',true,3),
  ('contract.agreement','Record the executed agreement','under_contract',true,4),
  ('contract.responsibilities','Confirm agreed dates and assigned responsibilities','under_contract',true,5),
  ('diligence.review','Record the inspection and disclosure review','due_diligence',true,6),
  ('diligence.decision','Record the client’s due-diligence decision','due_diligence',true,7),
  ('financing.funding','Confirm funding requirements have been reviewed','financing',true,8),
  ('financing.contingencies','Confirm outstanding contingencies have been reviewed','financing',true,9),
  ('closing.review','Confirm the final file review is complete','closing_prep',true,10),
  ('closing.arrangements','Record closing arrangements and client instructions','closing_prep',true,11)
 ) AS v(template_key,label,stage,required,sort_order)
 ON CONFLICT(transaction_id,template_key) DO NOTHING;
 RETURN NEW;
END $$;
