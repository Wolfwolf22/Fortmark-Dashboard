-- One pending action per contact; existing date-only reminders remain intact.
ALTER TABLE contacts
  ADD COLUMN next_action_id uuid,
  ADD COLUMN next_action_kind text,
  ADD COLUMN next_action_purpose text,
  ADD COLUMN next_action_due_at timestamptz,
  ADD COLUMN next_action_assigned_user_id uuid REFERENCES dashboard_users(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE contacts ADD CONSTRAINT contacts_next_action_check CHECK (
  (next_action_id IS NULL AND next_action_kind IS NULL AND next_action_purpose IS NULL AND next_action_due_at IS NULL AND next_action_assigned_user_id IS NULL)
  OR (next_action_id IS NOT NULL AND next_action_kind IS NOT NULL AND next_action_purpose IS NOT NULL AND next_action_due_at IS NOT NULL AND next_action_assigned_user_id IS NOT NULL
    AND next_action_kind IN ('call','email','text','meeting','custom')
    AND char_length(next_action_purpose) <= 240 AND char_length(btrim(next_action_purpose)) >= 1
    AND next_follow_up_at IS NOT NULL
    AND next_follow_up_at = (((next_action_due_at AT TIME ZONE 'America/New_York')::date + time '12:00') AT TIME ZONE 'UTC'))
);
--> statement-breakpoint
CREATE INDEX contacts_next_action_due_idx ON contacts(next_action_due_at);
