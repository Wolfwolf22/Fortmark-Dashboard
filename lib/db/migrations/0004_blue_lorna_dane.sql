CREATE TYPE "public"."profile_mls_verification_status" AS ENUM('unverified', 'verified');--> statement-breakpoint
ALTER TABLE "professional_profiles" ADD COLUMN "mls_agent_id" text;--> statement-breakpoint
ALTER TABLE "professional_profiles" ADD COLUMN "mls_organization" text;--> statement-breakpoint
ALTER TABLE "professional_profiles" ADD COLUMN "mls_verification_status" "profile_mls_verification_status" DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "professional_profiles" ADD COLUMN "mls_verified_at" timestamp with time zone;