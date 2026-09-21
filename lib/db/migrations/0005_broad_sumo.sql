CREATE TYPE "public"."transaction_deadline_kind" AS ENUM('inspection', 'financing', 'appraisal', 'hoa_condo_application', 'title', 'closing', 'possession', 'other');--> statement-breakpoint
CREATE TYPE "public"."transaction_party_role" AS ENUM('buyer', 'seller', 'landlord', 'tenant', 'co_agent', 'cooperating_agent', 'lender', 'title_company', 'attorney', 'escrow_holder', 'inspector', 'appraiser', 'other');--> statement-breakpoint
CREATE TYPE "public"."transaction_side" AS ENUM('listing', 'buyer', 'dual', 'landlord', 'tenant');--> statement-breakpoint
CREATE TYPE "public"."transaction_stage" AS ENUM('opportunity', 'offer', 'under_contract', 'due_diligence', 'financing', 'closing_prep', 'closed', 'cancelled', 'withdrawn', 'on_hold', 'fell_through');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('residential_sale', 'residential_lease', 'commercial_sale', 'commercial_lease', 'land');--> statement-breakpoint
CREATE TABLE "transaction_deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"kind" "transaction_deadline_kind" NOT NULL,
	"label" text NOT NULL,
	"due_date" date NOT NULL,
	"completed_at" timestamp with time zone,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"safe_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"role" "transaction_party_role" NOT NULL,
	"display_name" text NOT NULL,
	"company" text,
	"email" text,
	"phone_e164" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brokerage_key" text DEFAULT 'fortmark' NOT NULL,
	"agent_user_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"transaction_type" "transaction_type" NOT NULL,
	"side" "transaction_side" NOT NULL,
	"stage" "transaction_stage" DEFAULT 'opportunity' NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state" text DEFAULT 'FL' NOT NULL,
	"postal_code" text,
	"county" text,
	"property_sub_type" text,
	"listing_key" text,
	"mls_number" text,
	"list_price_cents" bigint,
	"offer_price_cents" bigint,
	"contract_price_cents" bigint,
	"commission_rate_bps" integer,
	"commission_flat_cents" bigint,
	"agent_split_bps" integer,
	"transaction_fee_cents" bigint,
	"referral_fee_bps" integer,
	"referral_payee" text,
	"commission_paid_cents" bigint,
	"commission_paid_at" timestamp with time zone,
	"contract_execution_date" date,
	"effective_date" date,
	"closing_date" date,
	"closed_date" date,
	"possession_date" date,
	"cancelled_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_deadlines" ADD CONSTRAINT "transaction_deadlines_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_events" ADD CONSTRAINT "transaction_events_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_events" ADD CONSTRAINT "transaction_events_actor_user_id_dashboard_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_parties" ADD CONSTRAINT "transaction_parties_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_agent_user_id_dashboard_users_id_fk" FOREIGN KEY ("agent_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_user_id_dashboard_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_updated_by_user_id_dashboard_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_deadlines_transaction_idx" ON "transaction_deadlines" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_deadlines_open_due_idx" ON "transaction_deadlines" USING btree ("due_date") WHERE "transaction_deadlines"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "transaction_events_transaction_created_idx" ON "transaction_events" USING btree ("transaction_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_parties_transaction_idx" ON "transaction_parties" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_brokerage_stage_idx" ON "transactions" USING btree ("brokerage_key","stage");--> statement-breakpoint
CREATE INDEX "transactions_agent_idx" ON "transactions" USING btree ("agent_user_id");--> statement-breakpoint
CREATE INDEX "transactions_closing_date_idx" ON "transactions" USING btree ("closing_date");--> statement-breakpoint
CREATE INDEX "transactions_listing_key_idx" ON "transactions" USING btree ("listing_key");--> statement-breakpoint
CREATE INDEX "transactions_mls_number_idx" ON "transactions" USING btree ("mls_number");