-- Durable delivery is independent of room lifetime and device-local ACKs.
CREATE TABLE IF NOT EXISTS sw_reward_receipts (
 account_id uuid NOT NULL REFERENCES sw_accounts(id),
 id text NOT NULL CHECK (id ~ '^(td|br|rc):[a-f0-9-]{36}$'),
 player_class text NOT NULL CHECK (player_class IN ('Banker','Vampire','Speedster','Politician')),
 reward jsonb NOT NULL CHECK (jsonb_typeof(reward)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 confirmed_at timestamptz,
 PRIMARY KEY(account_id,id)
);
CREATE INDEX IF NOT EXISTS sw_reward_pending_idx ON sw_reward_receipts(account_id,player_class) WHERE confirmed_at IS NULL;
INSERT INTO sw_schema_migrations(version) VALUES(5) ON CONFLICT DO NOTHING;
