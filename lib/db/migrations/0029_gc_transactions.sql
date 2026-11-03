-- Extend the enums by rebuilding them inside the normal atomic migration.
ALTER TYPE transaction_side RENAME TO transaction_side_pre_gc;
CREATE TYPE transaction_side AS ENUM ('listing','buyer','dual','landlord','tenant','gc');
ALTER TABLE transactions ALTER COLUMN side TYPE transaction_side USING side::text::transaction_side;
DROP TYPE transaction_side_pre_gc;
--> statement-breakpoint
ALTER TYPE transaction_type RENAME TO transaction_type_pre_gc;
CREATE TYPE transaction_type AS ENUM ('residential_sale','residential_lease','commercial_sale','commercial_lease','land','general_contractor');
ALTER TABLE transactions ALTER COLUMN transaction_type TYPE transaction_type USING transaction_type::text::transaction_type;
DROP TYPE transaction_type_pre_gc;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION seed_transaction_checklist_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.side::text = 'gc' THEN RETURN NEW; END IF;
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
