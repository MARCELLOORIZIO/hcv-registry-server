CREATE TABLE IF NOT EXISTS sigillum_mcp_credentials (
 token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 principal TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sigillum_mcp_credentials_expiry_idx ON sigillum_mcp_credentials(expires_at);
-- No credentials are created by applying this migration. Provisioning is administrative.
