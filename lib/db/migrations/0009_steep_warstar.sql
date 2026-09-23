CREATE TABLE "brokerage_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brokerage_key" text NOT NULL,
	"display_name" text NOT NULL,
	"license_number" text,
	"license_state" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"office_phone" text,
	"website" text,
	"mls_office_id" text,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brokerage_identities" ADD CONSTRAINT "brokerage_identities_created_by_user_id_dashboard_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brokerage_identities" ADD CONSTRAINT "brokerage_identities_updated_by_user_id_dashboard_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brokerage_identities_brokerage_key_key" ON "brokerage_identities" USING btree ("brokerage_key");