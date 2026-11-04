-- Additive storage: keep the existing active-profile limit and all account IDs.
ALTER TABLE sw_profiles ADD COLUMN IF NOT EXISTS class_roster jsonb
    CHECK (class_roster IS NULL OR (jsonb_typeof(class_roster)='object' AND octet_length(class_roster::text)<=1048576));
INSERT INTO sw_schema_migrations(version) VALUES (3) ON CONFLICT (version) DO NOTHING;
