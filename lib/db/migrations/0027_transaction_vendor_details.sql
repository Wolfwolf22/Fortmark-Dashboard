-- Preserve each specific vendor selection and its private service/financing records.
CREATE TABLE transaction_vendor_engagements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
 role text NOT NULL, vendor_id uuid NOT NULL REFERENCES brokerage_vendors(id) ON DELETE RESTRICT,
 vendor_name text NOT NULL, company text, email text, phone text,
 details jsonb NOT NULL DEFAULT '{"serviceDate":null,"serviceStatus":"not_recorded","costCents":null,"reference":null,"notes":"","quoteDate":null,"preApprovalAmountCents":null,"preApprovalIssuedDate":null,"preApprovalExpiryDate":null,"loanAmountCents":null,"loanType":null,"rateType":"not_recorded","interestRatePercent":null,"aprPercent":null,"termMonths":null,"rateLockExpiryDate":null,"monthlyPrincipalInterestCents":null,"monthlyPropertyTaxCents":null,"monthlyHomeInsuranceCents":null,"monthlyMortgageInsuranceCents":null,"monthlyHoaCents":null,"monthlyOtherCents":null,"lenderMonthlyTotalCents":null,"estimatedClosingCostsCents":null,"estimatedCashToCloseCents":null}'::jsonb,
 created_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL, updated_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT transaction_vendor_engagements_role_check CHECK(role IN ('inspector','mortgage','appraiser','termite','insurance','title','attorney','other')),
 CONSTRAINT transaction_vendor_engagements_details_check CHECK(jsonb_typeof(details)='object')
);
CREATE INDEX transaction_vendor_engagements_file_idx ON transaction_vendor_engagements(transaction_id,role,created_at);
ALTER TABLE transaction_vendor_selections ADD COLUMN detail_id uuid REFERENCES transaction_vendor_engagements(id) ON DELETE RESTRICT;
--> statement-breakpoint
INSERT INTO transaction_vendor_engagements(transaction_id,role,vendor_id,vendor_name,company,email,phone,created_at,updated_at)
 SELECT transaction_id,role,vendor_id,vendor_name,company,email,phone,created_at,updated_at FROM transaction_vendor_selections WHERE status='selected';
UPDATE transaction_vendor_selections s SET detail_id=e.id FROM transaction_vendor_engagements e WHERE s.status='selected' AND e.transaction_id=s.transaction_id AND e.role=s.role AND e.vendor_id=s.vendor_id;
--> statement-breakpoint
CREATE TABLE transaction_vendor_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
 detail_id uuid NOT NULL REFERENCES transaction_vendor_engagements(id) ON DELETE RESTRICT, kind text NOT NULL,
 storage_path text NOT NULL, filename text NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, sha256 text NOT NULL,
 uploaded_by_user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), removed_at timestamptz,
 CONSTRAINT transaction_vendor_attachments_kind_check CHECK(kind IN ('report','invoice','pre_approval','loan_estimate','insurance_quote','other')),
 CONSTRAINT transaction_vendor_attachments_size_check CHECK(size_bytes BETWEEN 1 AND 4194304),
 CONSTRAINT transaction_vendor_attachments_type_check CHECK(content_type IN ('application/pdf','image/jpeg','image/png')),
 CONSTRAINT transaction_vendor_attachments_hash_check CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 CONSTRAINT transaction_vendor_attachments_filename_check CHECK(char_length(filename) BETWEEN 1 AND 180)
);
CREATE UNIQUE INDEX transaction_vendor_attachments_path_idx ON transaction_vendor_attachments(storage_path);
CREATE INDEX transaction_vendor_attachments_detail_idx ON transaction_vendor_attachments(transaction_id,detail_id);
--> statement-breakpoint
ALTER TABLE transaction_write_requests DROP CONSTRAINT transaction_write_requests_action_check;
ALTER TABLE transaction_write_requests ADD CONSTRAINT transaction_write_requests_action_check CHECK(action IN ('create','edit','stage','add_deadline','edit_deadline','complete_deadline','reopen_deadline','remove_deadline','complete_checklist','reopen_checklist','upload_attachment','remove_attachment','set_attachment_requirement','set_vendor','edit_vendor_details','upload_vendor_attachment','remove_vendor_attachment'));
