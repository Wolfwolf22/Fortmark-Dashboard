CREATE TABLE "mls_member_links" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"license_number" text,
	"license_state" text,
	"member_key" text,
	"member_mls_id" text,
	"office_mls_id" text,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mls_member_links_status_check" CHECK ("mls_member_links"."status" in ('linked','office_mismatch','not_found','ambiguous','conflict','unavailable'))
);
--> statement-breakpoint
ALTER TABLE "brokerage_identities" ADD COLUMN "mls_office_key" text;--> statement-breakpoint
ALTER TABLE "brokerage_identities" ADD COLUMN "mls_office_name" text;--> statement-breakpoint
ALTER TABLE "brokerage_identities" ADD COLUMN "mls_office_phone" text;--> statement-breakpoint
ALTER TABLE "brokerage_identities" ADD COLUMN "mls_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mls_member_links" ADD CONSTRAINT "mls_member_links_user_id_dashboard_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mls_member_links_member_key_idx" ON "mls_member_links" USING btree ("member_key");