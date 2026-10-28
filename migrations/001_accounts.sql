-- Account foundation. Applied on accounts-dev only until the complete login flow is reviewed.
CREATE TABLE IF NOT EXISTS sw_schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sw_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,18}$'),
    display_name text NOT NULL CHECK (length(display_name) BETWEEN 3 AND 18),
    password_hash text NOT NULL CHECK (length(password_hash) BETWEEN 32 AND 512),
    recovery_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz,
    disabled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS sw_profiles (
    account_id uuid PRIMARY KEY REFERENCES sw_accounts(id),
    schema_version integer NOT NULL DEFAULT 4 CHECK (schema_version > 0),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    profile jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object' AND octet_length(profile::text) <= 262144),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sw_sessions (
    token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    account_id uuid NOT NULL REFERENCES sw_accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS sw_sessions_account_idx ON sw_sessions(account_id);
CREATE INDEX IF NOT EXISTS sw_sessions_expiry_idx ON sw_sessions(expires_at);
INSERT INTO sw_schema_migrations(version) VALUES (1) ON CONFLICT (version) DO NOTHING;
