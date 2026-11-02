-- Operational snapshots are entered by people; no past stage is auto-completed.
ALTER TABLE transactions ADD COLUMN checklist_template_version text NOT NULL DEFAULT 'brokerage-starter-v1';
--> statement-breakpoint
CREATE TABLE transaction_checklist_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
 template_key text NOT NULL, label text NOT NULL, stage transaction_stage NOT NULL,
 required boolean NOT NULL DEFAULT true, sort_order integer NOT NULL,
 completed_at timestamptz, completed_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT transaction_checklist_items_stage_check CHECK(stage IN ('opportunity','offer','under_contract','due_diligence','financing','closing_prep')),
 CONSTRAINT transaction_checklist_items_text_check CHECK(char_length(btrim(template_key)) BETWEEN 1 AND 160 AND char_length(btrim(label)) BETWEEN 1 AND 240),
 CONSTRAINT transaction_checklist_items_order_check CHECK(sort_order BETWEEN 0 AND 999),
 CONSTRAINT transaction_checklist_items_completion_check CHECK(completed_at IS NOT NULL OR completed_by_user_id IS NULL)
);
CREATE UNIQUE INDEX transaction_checklist_items_template_idx ON transaction_checklist_items(transaction_id,template_key);
CREATE INDEX transaction_checklist_items_stage_idx ON transaction_checklist_items(transaction_id,stage,sort_order);
--> statement-breakpoint
ALTER TABLE transaction_write_requests DROP CONSTRAINT transaction_write_requests_action_check;
ALTER TABLE transaction_write_requests ADD CONSTRAINT transaction_write_requests_action_check CHECK(action IN ('create','edit','stage','add_deadline','edit_deadline','complete_deadline','reopen_deadline','remove_deadline','complete_checklist','reopen_checklist'));
--> statement-breakpoint
INSERT INTO transaction_checklist_items(transaction_id,template_key,label,stage,required,sort_order)
 SELECT t.id,v.template_key,v.label,v.stage::transaction_stage,v.required,v.sort_order
 FROM transactions t CROSS JOIN (VALUES
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
--> statement-breakpoint
-- The trigger covers legacy/manual writers during rollout as well as the normal atomic create.
CREATE FUNCTION seed_transaction_checklist_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO transaction_checklist_items(transaction_id,template_key,label,stage,required,sort_order,created_at,updated_at)
 SELECT NEW.id,v.template_key,v.label,v.stage::transaction_stage,v.required,v.sort_order,NEW.created_at,NEW.updated_at
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
CREATE TRIGGER transactions_seed_checklist AFTER INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION seed_transaction_checklist_v1();
