-- Clan state is server-owned and independent of character/cloud-save revisions.
CREATE TABLE IF NOT EXISTS sw_clans (
 id uuid PRIMARY KEY,
 name text NOT NULL CHECK (length(name) BETWEEN 3 AND 24),
 tag text NOT NULL UNIQUE CHECK (tag ~ '^[A-Z0-9]{2,5}$'),
 state jsonb NOT NULL CHECK (jsonb_typeof(state)='object'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sw_clans_name_idx ON sw_clans(lower(name));
CREATE TABLE IF NOT EXISTS sw_clan_members (
 account_id uuid PRIMARY KEY REFERENCES sw_accounts(id),
 clan_id uuid NOT NULL REFERENCES sw_clans(id)
);
CREATE INDEX IF NOT EXISTS sw_clan_members_clan_idx ON sw_clan_members(clan_id);
CREATE TABLE IF NOT EXISTS sw_clan_war_results (
 id uuid PRIMARY KEY,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sw_schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
