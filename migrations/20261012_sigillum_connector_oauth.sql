-- Explicit experimental migration; production startup does not apply this file.
CREATE TABLE IF NOT EXISTS sigillum_connector_oauth_flows (
 flow_id TEXT PRIMARY KEY,
 csrf_hash TEXT NOT NULL,
 client_id TEXT NOT NULL,
 redirect_uri TEXT NOT NULL,
 resource TEXT NOT NULL,
 scope TEXT NOT NULL,
 client_state TEXT NOT NULL,
 code_challenge TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sigillum_connector_oauth_codes (
 code_hash TEXT PRIMARY KEY,
 client_id TEXT NOT NULL,
 redirect_uri TEXT NOT NULL,
 resource TEXT NOT NULL,
 scope TEXT NOT NULL,
 code_challenge TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 device_fingerprint TEXT NOT NULL,
 principal TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sigillum_connector_oauth_tokens (
 token_hash TEXT PRIMARY KEY,
 source_code_hash TEXT NOT NULL REFERENCES sigillum_connector_oauth_codes(code_hash) ON DELETE CASCADE,
 client_id TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 device_fingerprint TEXT NOT NULL,
 principal TEXT NOT NULL,
 issuer TEXT NOT NULL,
 resource TEXT NOT NULL,
 scope TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sigillum_connector_oauth_flows_expiry ON sigillum_connector_oauth_flows(expires_at);
CREATE INDEX IF NOT EXISTS sigillum_connector_oauth_tokens_owner ON sigillum_connector_oauth_tokens(account_id,client_id);
CREATE TABLE IF NOT EXISTS sigillum_connector_http_rates (
 key_hash TEXT PRIMARY KEY,
 window_started_at TIMESTAMPTZ NOT NULL,
 request_count INTEGER NOT NULL
);
