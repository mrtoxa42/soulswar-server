CREATE TABLE IF NOT EXISTS sw_economy_operations (
 account_id uuid NOT NULL REFERENCES sw_accounts(id),
 id uuid NOT NULL,
 fingerprint text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,id)
);
-- Aggregate queryable measurements; no username, chat, token or IP is stored.
CREATE TABLE IF NOT EXISTS sw_match_metrics (
 id text PRIMARY KEY,
 game text NOT NULL CHECK(game IN ('td','br','race')),
 result text NOT NULL,
 seconds double precision NOT NULL CHECK(seconds>=0),
 correct_chars integer NOT NULL CHECK(correct_chars>=0),
 errors integer NOT NULL CHECK(errors>=0),
 xp integer NOT NULL DEFAULT 0,
 coins integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sw_match_metrics_game_idx ON sw_match_metrics(game,created_at);
INSERT INTO sw_schema_migrations(version) VALUES(6) ON CONFLICT DO NOTHING;
