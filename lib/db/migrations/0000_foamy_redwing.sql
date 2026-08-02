CREATE TYPE "public"."profile_image_status" AS ENUM('clerk_only', 'uploaded', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."dashboard_user_role" AS ENUM('admin', 'broker', 'transaction_coordinator', 'agent', 'member');--> statement-breakpoint
CREATE TYPE "public"."dashboard_user_status" AS ENUM('active', 'pending_profile', 'suspended');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"target_user_id" uuid,
	"event_type" text NOT NULL,
	"safe_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"primary_email" text NOT NULL,
	"status" "dashboard_user_status" DEFAULT 'pending_profile' NOT NULL,
	"role" "dashboard_user_role" DEFAULT 'member' NOT NULL,
	"onboarding_complete" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legal_first_name" text,
	"legal_last_name" text,
	"preferred_display_name" text,
	"phone_e164" text,
	"brokerage_office" text,
	"license_state" text,
	"license_type" text,
	"license_number" text,
	"license_expiration" date,
	"nrds_number" text,
	"biography" text,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"specialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"service_areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"profile_completion_percent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"clerk_image_url" text,
	"active_image_url" text,
	"processed_image_url" text,
	"processing_status" "profile_image_status" DEFAULT 'clerk_only' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_dashboard_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_target_user_id_dashboard_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_user_id_dashboard_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_images" ADD CONSTRAINT "profile_images_user_id_dashboard_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "audit_events_type_idx" ON "audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_users_clerk_user_id_key" ON "dashboard_users" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "dashboard_users_status_idx" ON "dashboard_users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dashboard_users_role_idx" ON "dashboard_users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "professional_profiles_user_id_key" ON "professional_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_images_user_id_key" ON "profile_images" USING btree ("user_id");