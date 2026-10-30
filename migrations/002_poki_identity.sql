-- Additive identity mapping. Never link an existing password account by name.
CREATE TABLE IF NOT EXISTS sw_external_identities (
    provider text NOT NULL CHECK (provider = 'poki'),
    subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 256),
    account_id uuid NOT NULL UNIQUE REFERENCES sw_accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(provider, subject)
);
INSERT INTO sw_schema_migrations(version) VALUES (2) ON CONFLICT (version) DO NOTHING;
