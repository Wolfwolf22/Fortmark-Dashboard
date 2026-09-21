CREATE TYPE "public"."ai_action_status" AS ENUM('prepared', 'executing', 'executed', 'failed', 'stale', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "ai_prepared_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brokerage_key" text DEFAULT 'fortmark' NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"expected_fingerprint" text NOT NULL,
	"status" "ai_action_status" DEFAULT 'prepared' NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"failure_reason" text
);
--> statement-breakpoint
ALTER TABLE "ai_prepared_actions" ADD CONSTRAINT "ai_prepared_actions_actor_user_id_dashboard_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_prepared_actions_actor_status_idx" ON "ai_prepared_actions" USING btree ("actor_user_id","status");--> statement-breakpoint
CREATE INDEX "ai_prepared_actions_target_idx" ON "ai_prepared_actions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "ai_prepared_actions_expires_idx" ON "ai_prepared_actions" USING btree ("expires_at");