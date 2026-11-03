-- Verified opaque MLS references; live property/media data remains in the MLS.
ALTER TABLE transactions ADD COLUMN listing_dataset text;
ALTER TABLE transactions ADD COLUMN listing_linked_at timestamptz;
--> statement-breakpoint
CREATE TABLE transaction_showing_tours (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
 tour_id uuid NOT NULL REFERENCES saved_showing_tours(id) ON DELETE RESTRICT,
 created_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), removed_at timestamptz
);
CREATE UNIQUE INDEX transaction_showing_tours_pair_idx ON transaction_showing_tours(transaction_id,tour_id);
CREATE INDEX transaction_showing_tours_tour_idx ON transaction_showing_tours(tour_id,removed_at);
--> statement-breakpoint
ALTER TABLE transaction_write_requests DROP CONSTRAINT transaction_write_requests_action_check;
ALTER TABLE transaction_write_requests ADD CONSTRAINT transaction_write_requests_action_check CHECK(action IN ('create','edit','stage','add_deadline','edit_deadline','complete_deadline','reopen_deadline','remove_deadline','complete_checklist','reopen_checklist','upload_attachment','remove_attachment','set_attachment_requirement','set_vendor','edit_vendor_details','upload_vendor_attachment','remove_vendor_attachment','link_property','unlink_property','link_tour','unlink_tour'));
