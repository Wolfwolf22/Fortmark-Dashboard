CREATE TYPE "public"."contact_need_financing" AS ENUM('cash', 'conventional', 'fha', 'va', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."contact_need_kind" AS ENUM('buy', 'sell', 'rent', 'lease', 'other');--> statement-breakpoint
CREATE TYPE "public"."contact_need_status" AS ENUM('active', 'paused', 'fulfilled', 'archived');--> statement-breakpoint
CREATE TABLE "contact_needs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" "contact_need_kind" NOT NULL,
	"status" "contact_need_status" DEFAULT 'active' NOT NULL,
	"property_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"areas" text[] DEFAULT '{}'::text[] NOT NULL,
	"price_min_cents" bigint,
	"price_max_cents" bigint,
	"min_beds" smallint,
	"min_baths" numeric(3, 1),
	"min_sqft" integer,
	"target_date" date,
	"timeline_note" text,
	"financing" "contact_need_financing",
	"must_haves" text[] DEFAULT '{}'::text[] NOT NULL,
	"avoid" text[] DEFAULT '{}'::text[] NOT NULL,
	"additional_requirements" text,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_needs_price_check" CHECK (("contact_needs"."price_min_cents" is null or "contact_needs"."price_min_cents" >= 0) and ("contact_needs"."price_max_cents" is null or "contact_needs"."price_max_cents" >= 0) and ("contact_needs"."price_min_cents" is null or "contact_needs"."price_max_cents" is null or "contact_needs"."price_max_cents" >= "contact_needs"."price_min_cents")),
	CONSTRAINT "contact_needs_size_check" CHECK (("contact_needs"."min_beds" is null or "contact_needs"."min_beds" between 0 and 30) and ("contact_needs"."min_baths" is null or ("contact_needs"."min_baths" between 0 and 30 and ("contact_needs"."min_baths" * 2) = trunc("contact_needs"."min_baths" * 2))) and ("contact_needs"."min_sqft" is null or "contact_needs"."min_sqft" >= 0)),
	CONSTRAINT "contact_needs_bounds_check" CHECK (cardinality("contact_needs"."property_types") <= 8 and cardinality("contact_needs"."areas") <= 12 and cardinality("contact_needs"."must_haves") <= 20 and cardinality("contact_needs"."avoid") <= 20 and ("contact_needs"."timeline_note" is null or char_length("contact_needs"."timeline_note") <= 200) and ("contact_needs"."additional_requirements" is null or char_length("contact_needs"."additional_requirements") <= 2000))
);
--> statement-breakpoint
ALTER TABLE "contact_needs" ADD CONSTRAINT "contact_needs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_needs" ADD CONSTRAINT "contact_needs_created_by_user_id_dashboard_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_needs" ADD CONSTRAINT "contact_needs_updated_by_user_id_dashboard_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_needs_contact_status_idx" ON "contact_needs" USING btree ("contact_id","status");