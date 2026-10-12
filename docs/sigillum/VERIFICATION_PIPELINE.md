# Inspected controls and remaining mapping

Connector: authenticated principal -> scoped approved unexpired grant -> read-request audit event -> locked grant recheck -> active approving device -> matching certificate owner -> injected eligibility check -> unique single-use reservation -> COMMIT -> existing verified original reader -> MIME/size/signature checks -> completion event -> MCP image bytes.

Important: injected eligibility and original reader are composition requirements, not proof of connection to production. Completion is logged by bridge before dispatcher output validation. Real photo receipt and rendering remain untested.

Photo semantic diagnostic records probabilities and NOT_YET_INDEPENDENTLY_VERIFIED_ON_IOS; do not turn it into a definitive display verdict. Full ordering across provenance, integrity, scene and derivative verification still needs tracing in the application and backend. No thresholds changed.
