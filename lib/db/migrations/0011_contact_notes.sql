CREATE TABLE "contact_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	CONSTRAINT "contact_notes_body_check" CHECK (("contact_notes"."deleted_at" is null and "contact_notes"."body" is not null and char_length("contact_notes"."body") between 1 and 10000) or ("contact_notes"."deleted_at" is not null and "contact_notes"."body" is null))
);
--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_author_user_id_dashboard_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_deleted_by_user_id_dashboard_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."dashboard_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_notes_contact_created_idx" ON "contact_notes" USING btree ("contact_id","created_at" DESC NULLS LAST);