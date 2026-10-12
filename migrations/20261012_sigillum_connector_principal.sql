-- Optional schema extension for a future independently authenticated MCP connector.
-- Do not enable an MCP route simply by applying this migration.
-- A dedicated signed principal grant exchange and connector registration remain mandatory.
ALTER TABLE verified_originals_delegated_audits
  ADD COLUMN IF NOT EXISTS connector_principal_hash TEXT;
CREATE INDEX IF NOT EXISTS delegated_audit_connector_lookup_idx
  ON verified_originals_delegated_audits(request_id,connector_principal_hash)
  WHERE connector_principal_hash IS NOT NULL;
-- No existing browser-based grants are bound to an MCP principal:
-- NULL means DENY, not an implicit fallback to browser cookie.
