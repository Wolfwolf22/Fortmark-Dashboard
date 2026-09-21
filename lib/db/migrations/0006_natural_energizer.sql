CREATE TYPE "public"."contact_activity_kind" AS ENUM('call', 'email', 'sms', 'meeting', 'showing', 'note', 'status_change', 'task', 'system');--> statement-breakpoint
CREATE TYPE "public"."contact_source" AS ENUM('referral', 'sphere', 'sign_call', 'website', 'open_house', 'past_client', 'social', 'advertising', 'walk_in', 'other');--> statement-breakpoint
CREATE TYPE "public"."contact_stage" AS ENUM('lead', 'contacted', 'qualified', 'appointment', 'representation', 'active_client', 'under_contract', 'closed', 'past_client', 'lost', 'archived');--> statement-breakpoint
CREATE TYPE "public"."opportunity_kind" AS ENUM('buyer', 'seller', 'landlord', 'tenant', 'investor', 'commercial_buyer', 'commercial_seller', 'commercial_tenant', 'commercial_landlord', 'referral_source');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('open', 'won', 'lost', 'dormant');--> statement-breakpoint
CREATE TABLE "contact_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"actor_user_id" uuid,
	"kind" "contact_activity_kind" NOT NULL,
	"summary" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"safe_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" "opportunity_kind" NOT NULL,
	"status" "opportunity_status" DEFAULT 'open' NOT NULL,
	"area" text,
	"budget_min_cents" bigint,
	"budget_max_cents" bigint,
	"timeframe" text,
	"notes" text,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brokerage_key" text DEFAULT 'fortmark' NOT NULL,
	"assigned_agent_user_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"first_name" text,
	"last_name" text,
	"preferred_name" text,
	"email" text,
	"phone_e164" text,
	"company" text,
	"source" "contact_source" DEFAULT 'other' NOT NULL,
	"stage" "contact_stage" DEFAULT 'lead' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"last_contact_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_parties" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_activities" ADD CONSTRAINT "contact_activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_activities" ADD CONSTRAINT "contact_activities_opportunity_id_contact_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."contact_opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_activities" ADD CONSTRAINT "contact_activities_actor_user_id_dashboard_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_opportunities" ADD CONSTRAINT "contact_opportunities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_opportunities" ADD CONSTRAINT "contact_opportunities_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assigned_agent_user_id_dashboard_users_id_fk" FOREIGN KEY ("assigned_agent_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_user_id_dashboard_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_updated_by_user_id_dashboard_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_activities_contact_occurred_idx" ON "contact_activities" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "contact_opportunities_contact_idx" ON "contact_opportunities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_opportunities_transaction_idx" ON "contact_opportunities" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "contacts_brokerage_stage_idx" ON "contacts" USING btree ("brokerage_key","stage");--> statement-breakpoint
CREATE INDEX "contacts_agent_idx" ON "contacts" USING btree ("assigned_agent_user_id");--> statement-breakpoint
CREATE INDEX "contacts_last_contact_idx" ON "contacts" USING btree ("last_contact_at");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
ALTER TABLE "transaction_parties" ADD CONSTRAINT "transaction_parties_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_parties_contact_idx" ON "transaction_parties" USING btree ("contact_id");