CREATE TABLE "contact_create_requests" (
  "brokerage_key" text NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "dashboard_users"("id") ON DELETE RESTRICT,
  "request_id" uuid NOT NULL,
  "payload_hash" text NOT NULL CHECK (length("payload_hash") = 64),
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("brokerage_key", "actor_user_id", "request_id")
);
