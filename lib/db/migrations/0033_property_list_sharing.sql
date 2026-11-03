-- Additive proposal; root owns combining this into the next journaled migration.
CREATE TABLE property_list_shares (
  list_id uuid NOT NULL REFERENCES property_lists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
  shared_by_user_id uuid NOT NULL REFERENCES dashboard_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(list_id,user_id),
  CONSTRAINT property_list_shares_not_self CHECK(user_id<>shared_by_user_id)
);
CREATE INDEX property_list_shares_user_idx ON property_list_shares(user_id,list_id);
