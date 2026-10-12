# Tracked file inventory and static edges

Generated from local clones at inspected refs. An entry is not a claim that the file was fully reviewed. Static import/require edges omit dynamic loading and build-time rewrites.

## hcv-registry-server

```text
.github/COMMERCIAL_VALIDATION_TRIGGER
.github/workflows/audit-one-link-launch.yml
.github/workflows/check.yml
.github/workflows/closed-chain-reference-v2-validation.yml
.github/workflows/deploy-verified-originals-render.yml
.github/workflows/r2-audit-security-contract.yml
.github/workflows/r2-primary-provider-acceptance.yml
.github/workflows/r2-reference-acceptance.yml
.github/workflows/render-load-test.yml
.github/workflows/sigillum-connector-boundary.yml
.github/workflows/telegram-reference-acceptance.yml
.github/workflows/validate-production.yml
.github/workflows/verified-originals-production.yml
.github/workflows/verify-live-render-deployment.yml
.gitignore
.node-version
CLOSED_CHAIN_REFERENCE_V2_CHECKPOINT.md
DELEGATED_REFERENCE_AUDIT.md
PRIMARY_REFERENCE_LIFECYCLE_20261002.md
PRODUCTION_ACTIVATION.md
PRODUCTION_ARCHITECTURE.md
R2_REFERENCE_ACCEPTANCE.md
README.md
REFERENCE_PROVIDER_DECISION_20261001.md
TELEGRAM_REFERENCE_ACCEPTANCE.md
YOUTUBE_OAUTH_VERIFICATION_DEMO.md
app_store_account_binding_test.js
app_store_billing.js
app_store_ocsp_fallback_test.js
app_store_weekly_product_test.js
apple_associated_domains_test.js
apple_live_reconcile_runtime_test.js
apple_recent_verification_reconcile_runtime_test.js
audit_one_link_start_test.js
audit_reference_route_contract_test.js
audit_reference_scope.js
audit_reference_scope_test.js
auth_api.js
auth_proxy.js
auth_smoke_test.js
billing_status_freshness_runtime_test.js
certificate_account_binding.js
certificate_account_binding_runtime_test.js
certificate_account_binding_test.js
consumer_theme_account_reuse_test.js
creator_identity_isolation_test.js
delegated_reference_audit.js
delegated_reference_audit_test.js
delegated_reference_audit_ui.js
device_enrollment_approval_runtime_test.js
device_revocation_runtime_test.js
evidence/delegated-audit-cloud-browser.jpg
flutter
hcv_signature_canonical.js
hcv_signature_canonical_test.js
kyc_proxy.js
kyc_session_safety_test.js
legacy_public_claims_test.js
legal_documents.js
legal_documents_test.js
load_test.js
migrations/20261012_sigillum_connector_principal.sql
migrations/20261012_sigillum_mcp_credentials.sql
package-lock.json
package.json
photo_copy_verification_contract_test.js
photo_detail_compare.js
photo_detail_compare_test.js
prelaunch_cleanup_test_state.js
prelaunch_email_test.js
prelaunch_kyc_status_test.js
prelaunch_kyc_test.js
prelaunch_login_test.js
prelaunch_seed_subscription.js
primary_reference_lifecycle.js
primary_reference_lifecycle_pg_test.js
primary_reference_manifest.js
primary_reference_manifest_test.js
primary_reference_provider.js
primary_reference_provider_test.js
primary_reference_read_auth.js
primary_reference_read_auth_pg_test.js
production_config.js
production_config_test.js
production_server.js
production_smoke_test.js
profile_language_sync_runtime_test.js
r2_reference_acceptance_test.js
reference_visual_fingerprint_v3_real_media_test.js
reference_visual_fingerprint_v3_test.js
registry_provenance_v2.js
registry_provenance_v2_runtime_test.js
registry_provenance_v2_test.js
render.production.yaml
server.js
sigillum_connector_bridge.js
sigillum_connector_bridge_test.js
sigillum_connector_grant_adapter.js
sigillum_connector_grant_adapter_test.js
sigillum_connector_r2_capture.js
sigillum_connector_r2_capture_test.js
sigillum_mcp_auth.js
sigillum_mcp_auth_test.js
sigillum_mcp_credentials.js
sigillum_mcp_credentials_test.js
sigillum_mcp_dispatcher.js
sigillum_mcp_dispatcher_test.js
sigillum_mcp_http.js
sigillum_mcp_http_test.js
sigillum_mcp_service.js
sigillum_mcp_service_test.js
subtitle_derivation_contract_test.js
telegram_reference_acceptance_test.js
tool/apply_account_email_reuse.py
tool/apply_app_store_billing.py
tool/apply_apple_associated_domains.py
tool/apply_apple_live_reconcile.py
tool/apply_apple_recent_verification_reconcile.py
tool/apply_billing_status_freshness.py
tool/apply_certificate_account_binding.py
tool/apply_consumer_legal_theme.py
tool/apply_device_enrollment_approval.py
tool/apply_device_enrollment_postreview_hardening.py
tool/apply_device_revocation.py
tool/apply_hcv_signature_canonical_fix.py
tool/apply_kyc_session_safety.py
tool/apply_legal_localization_20260818.py
tool/apply_postgres_startup_retry.py
tool/apply_production_live_guard.py
tool/apply_production_runtime_safety.py
tool/apply_profile_language_sync.py
tool/apply_registry_provenance_v2.py
tool/apply_verified_originals_production.py
tool/audit_fixture_store.js
tool/audit_test_database.js
tool/delegated_audit_browser_fixture.js
tool/delegated_audit_fixture_images.json
tool/delegated_audit_fixture_smoke.js
tool/ensure_device_enrollment_schema.js
tool/r2_primary_provider_acceptance.js
tool/r2_primary_reference_provider_acceptance.js
tool/r2_reference_acceptance.js
tool/r2_reference_acceptance_sdk.js
tool/telegram_reference_acceptance.js
tool/youtube_oauth_demo_windows.ps1
tool/youtube_oauth_provision.js
tool/youtube_scope_demo.js
verified_originals_production.js
verified_originals_production_contract_test.js
verified_originals_production_test.js
verified_originals_r2_production_test.js
youtube_oauth_tools_test.js
```

### Source dependency edges

```text
app_store_account_binding_test.js -> fs
app_store_billing.js -> crypto, https, @apple/app-store-server-library
app_store_ocsp_fallback_test.js -> fs
app_store_weekly_product_test.js -> fs, ./app_store_billing
apple_associated_domains_test.js -> fs
apple_live_reconcile_runtime_test.js -> assert, fs
apple_recent_verification_reconcile_runtime_test.js -> fs, assert
audit_one_link_start_test.js -> node:test, node:assert/strict, ./delegated_reference_audit_ui
audit_reference_route_contract_test.js -> node:assert/strict, node:test, node:fs, node:path
audit_reference_scope.js -> crypto
audit_reference_scope_test.js -> node:assert/strict, node:test, ./audit_reference_scope
auth_api.js -> crypto, fs, path, better-sqlite3
auth_proxy.js -> http, crypto, fs, path, better-sqlite3, ./kyc_proxy.js
auth_smoke_test.js -> assert, crypto, fs, os, path, child_process
billing_status_freshness_runtime_test.js -> fs, assert
certificate_account_binding.js -> crypto
certificate_account_binding_runtime_test.js -> assert, fs, ./certificate_account_binding
certificate_account_binding_test.js -> assert, crypto, ./certificate_account_binding
consumer_theme_account_reuse_test.js -> fs, assert
creator_identity_isolation_test.js -> node:assert/strict, node:fs
delegated_reference_audit.js -> node:crypto, ./delegated_reference_audit_ui
delegated_reference_audit_test.js -> node:assert/strict, node:test, node:http, node:crypto, pg, ./delegated_reference_audit, ./primary_reference_read_auth, ./delegated_reference_audit_ui, ./tool/audit_test_database
device_enrollment_approval_runtime_test.js -> fs
device_revocation_runtime_test.js -> fs
hcv_signature_canonical_test.js -> assert, crypto, ./hcv_signature_canonical
kyc_proxy.js -> http, crypto, fs, path, better-sqlite3, ./server.js
kyc_session_safety_test.js -> fs, assert
legacy_public_claims_test.js -> assert, fs
legal_documents_test.js -> assert, crypto, ./legal_documents
photo_copy_verification_contract_test.js -> assert, fs
photo_detail_compare.js -> fs, path, child_process, util
photo_detail_compare_test.js -> assert, ./photo_detail_compare
prelaunch_cleanup_test_state.js -> pg
prelaunch_email_test.js -> crypto
prelaunch_kyc_status_test.js -> crypto
prelaunch_kyc_test.js -> crypto
prelaunch_login_test.js -> crypto
prelaunch_seed_subscription.js -> pg
primary_reference_lifecycle.js -> crypto, ./primary_reference_provider
primary_reference_lifecycle_pg_test.js -> assert/strict, crypto, pg, ./primary_reference_lifecycle
primary_reference_manifest.js -> crypto
primary_reference_manifest_test.js -> assert/strict, crypto, ./primary_reference_manifest
primary_reference_provider.js -> crypto, fs, os, path, stream/promises, @aws-sdk/client-s3, @aws-sdk/lib-storage, @aws-sdk/s3-request-presigner
primary_reference_provider_test.js -> assert/strict, crypto, fs, os, path, stream, ./primary_reference_provider
primary_reference_read_auth.js -> crypto
primary_reference_read_auth_pg_test.js -> assert/strict, crypto, pg, ./primary_reference_lifecycle, ./primary_reference_read_auth
production_config.js -> crypto
production_config_test.js -> crypto, ./production_config
production_server.js -> http, crypto, pg
production_smoke_test.js -> crypto
profile_language_sync_runtime_test.js -> fs
r2_reference_acceptance_test.js -> assert, crypto, fs, os, path, ./tool/r2_reference_acceptance
reference_visual_fingerprint_v3_real_media_test.js -> node:assert/strict, node:fs, node:os, node:path, node:child_process, ffmpeg-static, ./verified_originals_production
reference_visual_fingerprint_v3_test.js -> assert, crypto, ./verified_originals_production
registry_provenance_v2.js -> crypto
registry_provenance_v2_runtime_test.js -> assert, fs, ./registry_provenance_v2
registry_provenance_v2_test.js -> assert, ./registry_provenance_v2
server.js -> http, path, better-sqlite3, ./auth_api
sigillum_connector_bridge_test.js -> node:test, node:assert/strict, ./sigillum_connector_bridge
sigillum_connector_grant_adapter.js -> node:crypto
sigillum_connector_grant_adapter_test.js -> node:test, node:assert/strict, node:crypto, ./sigillum_connector_grant_adapter
sigillum_connector_r2_capture.js -> node:stream
sigillum_connector_r2_capture_test.js -> node:test, node:assert/strict, ./sigillum_connector_r2_capture
sigillum_mcp_auth.js -> node:crypto
sigillum_mcp_auth_test.js -> node:test, node:assert/strict, node:crypto, ./sigillum_mcp_auth
sigillum_mcp_credentials.js -> node:crypto
sigillum_mcp_credentials_test.js -> node:test, node:assert/strict, node:crypto, ./sigillum_mcp_credentials
sigillum_mcp_dispatcher.js -> ./sigillum_connector_bridge
sigillum_mcp_dispatcher_test.js -> node:test, node:assert/strict, ./sigillum_mcp_dispatcher, ./sigillum_mcp_auth
sigillum_mcp_http.js -> node:http
sigillum_mcp_http_test.js -> node:test, node:assert/strict, ./sigillum_mcp_http
sigillum_mcp_service.js -> ./sigillum_mcp_dispatcher, ./sigillum_connector_grant_adapter, ./sigillum_connector_r2_capture
sigillum_mcp_service_test.js -> node:test, node:assert/strict, ./sigillum_mcp_service, node:crypto
subtitle_derivation_contract_test.js -> node:assert/strict, node:crypto, ./verified_originals_production
telegram_reference_acceptance_test.js -> assert, crypto, fs, os, path, ./tool/telegram_reference_acceptance
tool/apply_app_store_billing.py -> pg, ./app_store_billing
tool/apply_certificate_account_binding.py -> crypto, ./certificate_account_binding
tool/apply_hcv_signature_canonical_fix.py -> crypto, ./hcv_signature_canonical
tool/apply_legal_localization_20260818.py -> ./legal_documents, pg
tool/apply_production_live_guard.py -> pg, ./production_config, ./legal_documents
tool/apply_registry_provenance_v2.py -> ./certificate_account_binding, ./registry_provenance_v2
tool/apply_verified_originals_production.py -> ./registry_provenance_v2, ./verified_originals_production
tool/audit_test_database.js -> @electric-sql/pglite
tool/delegated_audit_browser_fixture.js -> node:http, node:crypto, node:fs, node:os, node:path, node:stream, node:stream/promises, ./audit_fixture_store, ../delegated_reference_audit, ../primary_reference_read_auth, ../primary_reference_provider, ../delegated_reference_audit_ui, ./delegated_audit_fixture_images.json
tool/delegated_audit_fixture_smoke.js -> node:assert/strict, node:crypto, ./delegated_audit_fixture_images.json, node:child_process, node:path
tool/ensure_device_enrollment_schema.js -> pg
tool/r2_primary_provider_acceptance.js -> crypto, fs, os, path, ../primary_reference_provider
tool/r2_primary_reference_provider_acceptance.js -> crypto, fs, os, path, stream/promises, stream, ../primary_reference_provider
tool/r2_reference_acceptance.js -> crypto, fs, https, os, path, stream/promises, stream
tool/r2_reference_acceptance_sdk.js -> crypto, fs, os, path, stream/promises, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, stream
tool/telegram_reference_acceptance.js -> crypto, fs, os, path, child_process, stream/promises, stream, ffmpeg-static
tool/youtube_oauth_provision.js -> crypto, fs, http, child_process
tool/youtube_scope_demo.js -> fs, os, path, readline, child_process, ffmpeg-static, ./youtube_oauth_provision
verified_originals_production.js -> crypto, fs, os, path, util, child_process, stream/promises, ./primary_reference_provider, ./primary_reference_lifecycle, ./primary_reference_manifest, ./primary_reference_read_auth, ./photo_detail_compare, ./audit_reference_scope, ./delegated_reference_audit, ffmpeg-static
verified_originals_production_contract_test.js -> node:assert/strict, node:fs, ./verified_originals_production
verified_originals_production_test.js -> node:assert/strict, node:crypto, node:fs, node:http, node:os, node:path, node:child_process, pg, ffmpeg-static, ./verified_originals_production
verified_originals_r2_production_test.js -> node:assert/strict, node:crypto, node:fs, node:http, node:os, node:path, node:child_process, pg, ffmpeg-static, ./verified_originals_production, ./primary_reference_provider
youtube_oauth_tools_test.js -> assert, fs, os, path, ./tool/youtube_oauth_provision, ./tool/youtube_scope_demo
```

## sigillum-hcv

```text
.github/CODEMAGIC_BUILD129_VERIFIED_ORIGINALS_TRIGGER
.github/CODEMAGIC_FINAL_TRIGGER
.github/COMMERCIAL_VALIDATION_TRIGGER
.github/COMMERCIAL_VALIDATION_TRIGGER_2
.github/workflows/build117-architecture-validation.yml
.github/workflows/build118-photo-preview-validation.yml
.github/workflows/build119-photo-rotation-validation.yml
.github/workflows/build120-passive-scene-context-validation.yml
.github/workflows/build121-unified-validation.yml
.github/workflows/build122-corpus-wide-validation.yml
.github/workflows/build123-context-free-validation.yml
.github/workflows/build124-multi-evidence-validation.yml
.github/workflows/build125-zoom-coherent-hfr-validation.yml
.github/workflows/build126-video-fov-persistence-validation.yml
.github/workflows/build127-convert-v3-dualbranch.yml
.github/workflows/build127-export-v2-model.yml
.github/workflows/build127-ml-hard-negative-validation.yml
.github/workflows/build127-v3-tflite.yml
.github/workflows/build128-derivative-integrity-validation.yml
.github/workflows/build128-original-hard-binding-validation.yml
.github/workflows/build128-photo-video-preview-fov-parity.yml
.github/workflows/build129-ios-verified-originals-validation.yml
.github/workflows/build133-closed-chain-validation.yml
.github/workflows/diagnose-ml-rc2-20260825.yml
.github/workflows/diagnose-rc2-generated-policy-tests.yml
.github/workflows/flutter-ci.yml
.github/workflows/materialize-rc2-source-20260826.yml
.github/workflows/photo-framing-conversion-probe.yml
.github/workflows/photo-framing-final-model-conversion.yml
.github/workflows/photo-framing-install-verified-model.yml
.github/workflows/photo-framing-ios-experimental-build.yml
.github/workflows/photo-framing-ios-unsigned-validation.yml
.github/workflows/photo-framing-pretrained-weights.yml
.github/workflows/trigger-codemagic-build129.yml
.github/workflows/validate-commercial-localization.yml
.github/workflows/validate-planar-parallax.yml
.github/workflows/validate-rc2-20260825.yml
.github/workflows/validate-rc2-macos-preipa-20260825.yml
.github/workflows/verified-originals-v02-app.yml
.gitignore
.metadata
APP_STORE_PRIVACY_POLICY_DRAFT.md
APP_STORE_READINESS.md
APP_STORE_TERMS_DRAFT.md
BILLING_E2E_CHECKPOINT_20260829.md
BUILD133_CLOSED_CHAIN_CHECKPOINT.md
MATERIALIZATION_STATUS_20260826.md
MODIFICHE/HCV_CHECKPOINT_MANIFEST.md
MODIFICHE/HcvImportService.txt
MODIFICHE/camera_page.dart
MODIFICHE/camera_service.dart
MODIFICHE/hcv_checkpoint_audio_live_patch.zip
MODIFICHE/hcv_checkpoint_manifest.json
MODIFICHE/hcv_crypto.dart
MODIFICHE/hcv_engine.dart
MODIFICHE/hcv_identity.dart
MODIFICHE/hcv_import_router_page.dart
MODIFICHE/hcv_import_service.dart
MODIFICHE/hcv_live_signals.dart
MODIFICHE/hcv_package.dart
MODIFICHE/hcv_registry_service.dart
MODIFICHE/hcv_trust_analyzer.dart
MODIFICHE/hcv_verifier.dart
MODIFICHE/hcv_video_watermark.dart
MODIFICHE/hcvpack_player_page.dart
MODIFICHE/home_page.dart
MODIFICHE/import_page.dart
MODIFICHE/main.dart
MODIFICHE/registry_verify_page.dart
MODIFICHE/text_cert_page.dart
MODIFICHE/verifier_page.dart
MODIFICHE/verify_page.dart
MODIFICHE/video_player_verify_page.dart
MODIFICHE/video_verify_page.dart
README.md
RELEASE_HARDENING_NOTES_20260826.md
SIGILLUM_PATENT_INVENTION_MAP.md
SIGILLUM_PRODUCT_COMMUNICATION.md
VERSIONE FUNZIONANTE  LOCALE 5/HcvImportService.txt
VERSIONE FUNZIONANTE  LOCALE 5/camera_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/camera_service.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_crypto.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_engine.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_identity.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_import_router_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_import_service.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_live_signals.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_package.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_registry_service.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_trust_analyzer.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_verifier.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_video_watermark.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcvpack_player_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/home_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/identity_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/import_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/main.dart
VERSIONE FUNZIONANTE  LOCALE 5/registry_verify_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/text_cert_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/verifier_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/verify_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/video_player_verify_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/video_verify_page.dart
VERSIONE FUNZIONANTE 1/HcvImportService.txt
VERSIONE FUNZIONANTE 1/camera_page.dart
VERSIONE FUNZIONANTE 1/camera_service.dart
VERSIONE FUNZIONANTE 1/hcv_engine.dart
VERSIONE FUNZIONANTE 1/hcv_import_router_page.dart
VERSIONE FUNZIONANTE 1/hcv_import_service.dart
VERSIONE FUNZIONANTE 1/hcv_package.dart
VERSIONE FUNZIONANTE 1/hcv_verifier.dart
VERSIONE FUNZIONANTE 1/hcvpack_player_page.dart
VERSIONE FUNZIONANTE 1/home_page.dart
VERSIONE FUNZIONANTE 1/import_page.dart
VERSIONE FUNZIONANTE 1/main.dart
VERSIONE FUNZIONANTE 1/text_cert_page.dart
VERSIONE FUNZIONANTE 1/verifier_page.dart
VERSIONE FUNZIONANTE 1/verify_page.dart
VERSIONE FUNZIONANTE 1/video_player_verify_page.dart
VERSIONE FUNZIONANTE 1/video_verify_page.dart
VERSIONE FUNZIONANTE 2/HcvImportService.txt
VERSIONE FUNZIONANTE 2/camera_page.dart
VERSIONE FUNZIONANTE 2/camera_service.dart
VERSIONE FUNZIONANTE 2/hcv_engine.dart
VERSIONE FUNZIONANTE 2/hcv_import_router_page.dart
VERSIONE FUNZIONANTE 2/hcv_import_service.dart
VERSIONE FUNZIONANTE 2/hcv_package.dart
VERSIONE FUNZIONANTE 2/hcv_verifier.dart
VERSIONE FUNZIONANTE 2/hcvpack_player_page.dart
VERSIONE FUNZIONANTE 2/home_page.dart
VERSIONE FUNZIONANTE 2/import_page.dart
VERSIONE FUNZIONANTE 2/main.dart
VERSIONE FUNZIONANTE 2/text_cert_page.dart
VERSIONE FUNZIONANTE 2/verifier_page.dart
VERSIONE FUNZIONANTE 2/verify_page.dart
VERSIONE FUNZIONANTE 2/video_player_verify_page.dart
VERSIONE FUNZIONANTE 2/video_verify_page.dart
VERSIONE FUNZIONANTE 3/HcvImportService.txt
VERSIONE FUNZIONANTE 3/camera_page.dart
VERSIONE FUNZIONANTE 3/camera_service.dart
VERSIONE FUNZIONANTE 3/hcv_crypto.dart
VERSIONE FUNZIONANTE 3/hcv_engine.dart
VERSIONE FUNZIONANTE 3/hcv_identity.dart
VERSIONE FUNZIONANTE 3/hcv_import_router_page.dart
VERSIONE FUNZIONANTE 3/hcv_import_service.dart
VERSIONE FUNZIONANTE 3/hcv_package.dart
VERSIONE FUNZIONANTE 3/hcv_verifier.dart
VERSIONE FUNZIONANTE 3/hcvpack_player_page.dart
VERSIONE FUNZIONANTE 3/home_page.dart
VERSIONE FUNZIONANTE 3/identity_page.dart
VERSIONE FUNZIONANTE 3/import_page.dart
VERSIONE FUNZIONANTE 3/main.dart
VERSIONE FUNZIONANTE 3/text_cert_page.dart
VERSIONE FUNZIONANTE 3/verifier_page.dart
VERSIONE FUNZIONANTE 3/verify_page.dart
VERSIONE FUNZIONANTE 3/video_player_verify_page.dart
VERSIONE FUNZIONANTE 3/video_verify_page.dart
VERSIONE FUNZIONANTE/camera_page.dart
VERSIONE FUNZIONANTE/camera_service.dart
VERSIONE FUNZIONANTE/hcv_engine.dart
VERSIONE FUNZIONANTE/hcv_verifier.dart
VERSIONE FUNZIONANTE/home_page.dart
VERSIONE FUNZIONANTE/main.dart
VERSIONE FUNZIONANTE/text_cert_page.dart
VERSIONE FUNZIONANTE/verifier_page.dart
VERSIONE FUNZIONANTE/verify_page.dart
VERSIONE FUNZIONANTE/video_player_verify_page.dart
VERSIONE FUNZIONANTE/video_verify_page.dart
ai_trainer_server/.env.example
ai_trainer_server/.gitignore
ai_trainer_server/README.md
ai_trainer_server/package-lock.json
ai_trainer_server/package.json
ai_trainer_server/server.js
analysis_options.yaml
android/.gitignore
android/app/build.gradle.kts
android/app/src/debug/AndroidManifest.xml
android/app/src/main/AndroidManifest.xml
android/app/src/main/kotlin/com/example/hcv_app/MainActivity.kt
android/app/src/main/kotlin/com/example/hcv_app/hcv_keystore_signer.dart
android/app/src/main/res/drawable-hdpi/ic_launcher_foreground.png
android/app/src/main/res/drawable-mdpi/ic_launcher_foreground.png
android/app/src/main/res/drawable-v21/launch_background.xml
android/app/src/main/res/drawable-xhdpi/ic_launcher_foreground.png
android/app/src/main/res/drawable-xxhdpi/ic_launcher_foreground.png
android/app/src/main/res/drawable-xxxhdpi/ic_launcher_foreground.png
android/app/src/main/res/drawable/launch_background.xml
android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
android/app/src/main/res/mipmap-hdpi/ic_launcher.png
android/app/src/main/res/mipmap-mdpi/ic_launcher.png
android/app/src/main/res/mipmap-xhdpi/ic_launcher.png
android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png
android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
android/app/src/main/res/values-night/styles.xml
android/app/src/main/res/values/colors.xml
android/app/src/main/res/values/styles.xml
android/app/src/profile/AndroidManifest.xml
android/build.gradle.kts
android/gradle.properties
android/gradle/wrapper/gradle-wrapper.properties
android/settings.gradle.kts
assets/icon/icon.png
assets/ml/sigillum_photo_framing_v1.tflite
assets/ml/sigillum_screen_replay_model_update.zip
assets/ml/sigillum_screen_replay_v1.tflite
assets/ml/sigillum_screen_replay_v1_labels.json
assets/ml/sigillum_screen_replay_v2.tflite
assets/ml/sigillum_screen_replay_v3_dualbranch.tflite
assets/ml/sigillum_screen_replay_v3_multihead.tflite
codemagic.yaml
docs/.nojekyll
docs/COMMERCIAL_PRELAUNCH_GUARDRAILS.md
docs/SIGILLUM_ORIGINAL_DERIVATION_CHAIN_V1.md
docs/delete-data/index.html
docs/index.html
docs/privacy/index.html
docs/styles.css
docs/support/index.html
docs/terms/index.html
hcv_1777814592219.hcv
hcv_1777822971987.hcv
hcv_1777824393237.hcv
hcv_1777824622312.hcv
hcv_1777824905288.hcv
hcv_1777825052503.hcv
hcv_1777825054083.hcv
hcv_1777825890781.hcv
hcv_1777835122824.hcv
hcv_1777835323548.hcv
hcv_modifiche_complete.zip
hcv_modifiche_complete/hcv_modifiche/camera_page.dart
hcv_modifiche_complete/hcv_modifiche/hcv_import_router_page.dart
hcv_modifiche_complete/hcv_modifiche/hcv_import_service.dart
hcv_modifiche_complete/hcv_modifiche/hcvpack_player_page.dart
hcv_modifiche_complete/hcv_modifiche/home_page.dart
hcv_modifiche_complete/hcv_modifiche/verify_page.dart
hcv_modifiche_complete/hcv_modifiche/video_verify_page.dart
hcv_registry_server.zip
ios/.gitignore
ios/Flutter/AppFrameworkInfo.plist
ios/Flutter/Debug.xcconfig
ios/Flutter/Release.xcconfig
ios/Flutter/SigillumEdition.xcconfig
ios/Podfile
ios/Runner.xcodeproj/project.pbxproj
ios/Runner.xcodeproj/project.xcworkspace/contents.xcworkspacedata
ios/Runner.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist
ios/Runner.xcodeproj/project.xcworkspace/xcshareddata/WorkspaceSettings.xcsettings
ios/Runner.xcodeproj/xcshareddata/xcschemes/Runner.xcscheme
ios/Runner.xcworkspace/contents.xcworkspacedata
ios/Runner.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist
ios/Runner.xcworkspace/xcshareddata/WorkspaceSettings.xcsettings
ios/Runner/AppDelegate.swift
ios/Runner/Assets.xcassets/AppIcon.appiconset/Contents.json
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-20x20@1x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-20x20@2x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-20x20@3x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-29x29@1x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-29x29@2x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-29x29@3x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-40x40@1x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-40x40@2x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-40x40@3x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-50x50@1x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-50x50@2x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-57x57@1x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-57x57@2x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-60x60@2x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-60x60@3x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-72x72@1x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-72x72@2x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-76x76@1x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-76x76@2x.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-83.5x83.5@2x.png
ios/Runner/Assets.xcassets/LaunchImage.imageset/Contents.json
ios/Runner/Assets.xcassets/LaunchImage.imageset/LaunchImage.png
ios/Runner/Assets.xcassets/LaunchImage.imageset/LaunchImage@2x.png
ios/Runner/Assets.xcassets/LaunchImage.imageset/LaunchImage@3x.png
ios/Runner/Assets.xcassets/LaunchImage.imageset/README.md
ios/Runner/Base.lproj/LaunchScreen.storyboard
ios/Runner/Base.lproj/Main.storyboard
ios/Runner/Info.plist
ios/Runner/Runner-Bridging-Header.h
ios/Runner/Runner.entitlements
ios/Runner/SceneDelegate.swift
ios/Runner/en.lproj/InfoPlist.strings
ios/Runner/es.lproj/InfoPlist.strings
ios/Runner/it.lproj/InfoPlist.strings
ios/Runner/ru.lproj/InfoPlist.strings
ios/RunnerTests/RunnerTests.swift
ios/SigillumShareExtension/Info.plist
ios/SigillumShareExtension/ShareViewController.swift
ios/SigillumShareExtension/SigillumShareExtension.entitlements
lib/HCV_CHECKPOINT_MANIFEST.md
lib/HcvImportService.txt
lib/Untitled-2.txt
lib/account_page.dart
lib/camera_page.dart
lib/camera_service.dart
lib/camera_ui_copy.dart
lib/camera_ui_extended_copy.dart
lib/commercial_account_service.dart
lib/commercial_billing_service.dart
lib/commercial_gate.dart
lib/commercial_profile_page.dart
lib/hcv_active_display_classifier.dart
lib/hcv_ai_training_service.dart
lib/hcv_audio_fingerprint.dart
lib/hcv_auth_service.dart
lib/hcv_capture_location.dart
lib/hcv_capture_provenance.dart
lib/hcv_capture_timestamp.dart
lib/hcv_checkpoint_manifest.json
lib/hcv_context_free_display_policy.dart
lib/hcv_crypto.dart
lib/hcv_display_final_policy.dart
lib/hcv_display_lattice_discriminator.dart
lib/hcv_display_risk_fusion.dart
lib/hcv_engine.dart
lib/hcv_file_provenance_gate_page.dart
lib/hcv_id_lookup_page.dart
lib/hcv_identity.dart
lib/hcv_image_watermark.dart
lib/hcv_import_router_page.dart
lib/hcv_import_service.dart
lib/hcv_keystore_signer.dart
lib/hcv_live_screen_probe.dart
lib/hcv_live_screen_probe_core.dart
lib/hcv_live_screen_probe_geometry.dart
lib/hcv_live_screen_probe_models.dart
lib/hcv_live_screen_probe_sampling.dart
lib/hcv_live_signals.dart
lib/hcv_location_image_watermark.dart
lib/hcv_location_video_watermark.dart
lib/hcv_logo_badge.dart
lib/hcv_media_id_ocr.dart
lib/hcv_ml_model_store.dart
lib/hcv_ml_screen_replay_classifier.dart
lib/hcv_ml_v3_photo_residual.dart
lib/hcv_multi_evidence_display_policy.dart
lib/hcv_package.dart
lib/hcv_photo_detail_compare.dart
lib/hcv_photo_framing_evidence.dart
lib/hcv_photo_semantic_framing_contract.dart
lib/hcv_photo_semantic_framing_inference.dart
lib/hcv_photo_semantic_framing_runner.dart
lib/hcv_photo_visual_framing.dart
lib/hcv_planar_motion_model.dart
lib/hcv_projective_motion_model.dart
lib/hcv_provenance_chain.dart
lib/hcv_reference_visual_fingerprint_v3.dart
lib/hcv_registry_provenance.dart
lib/hcv_registry_service.dart
lib/hcv_scene_context_evidence.dart
lib/hcv_scene_decision_fusion.dart
lib/hcv_scene_geometry_classifier.dart
lib/hcv_screen_replay_analyzer.dart
lib/hcv_secure_media_vault.dart
lib/hcv_secure_preview_service.dart
lib/hcv_secure_store.dart
lib/hcv_social_fingerprint.dart
lib/hcv_software_attestation.dart
lib/hcv_spatial_fingerprint_v2.dart
lib/hcv_temporal_capture_probe.dart
lib/hcv_temporal_frequency_probe.dart
lib/hcv_text_integrity.dart
lib/hcv_trust_analyzer.dart
lib/hcv_verifier.dart
lib/hcv_video_photo_spatial_evidence.dart
lib/hcv_video_watermark.dart
lib/hcvpack_player_page.dart
lib/hcvpack_provenance_gate_page.dart
lib/home_page.dart
lib/identity_page.dart
lib/import_page.dart
lib/lab_ui_copy.dart
lib/legal_info_page.dart
lib/main X ANDROID.dart
lib/main.dart
lib/manual_reference_compare_page.dart
lib/quick_hcv_media_gate_page.dart
lib/recent_account_service.dart
lib/registry_verify_copy.dart
lib/registry_verify_page.dart
lib/screen_replay_calibration_page.dart
lib/screen_replay_diagnostics_page.dart
lib/secure_originals_page.dart
lib/sigillum_edition.dart
lib/sigillum_localization.dart
lib/sigillum_quick_guide_page.dart
lib/sigillum_theme.dart
lib/test_watermark.dart
lib/text_cert_page.dart
lib/text_social_verify_page.dart
lib/user_home_page.dart
lib/verification_ui_copy.dart
lib/verified_originals_consent_page.dart
lib/verified_originals_page.dart
lib/verified_originals_publish_service.dart
lib/verified_originals_reference.dart
lib/verified_reference_viewer_page.dart
lib/verifier_page.dart
lib/verify_page.dart
lib/video_player_verify_page.dart
lib/video_transcription_service.dart
lib/video_verify_page.dart
linux/.gitignore
linux/CMakeLists.txt
linux/flutter/CMakeLists.txt
linux/flutter/generated_plugin_registrant.cc
linux/flutter/generated_plugin_registrant.h
linux/flutter/generated_plugins.cmake
linux/runner/CMakeLists.txt
linux/runner/main.cc
linux/runner/my_application.cc
linux/runner/my_application.h
macos/.gitignore
macos/Flutter/Flutter-Debug.xcconfig
macos/Flutter/Flutter-Release.xcconfig
macos/Flutter/GeneratedPluginRegistrant.swift
macos/Podfile
macos/Runner.xcodeproj/project.pbxproj
macos/Runner.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist
macos/Runner.xcodeproj/xcshareddata/xcschemes/Runner.xcscheme
macos/Runner.xcworkspace/contents.xcworkspacedata
macos/Runner.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist
macos/Runner/AppDelegate.swift
macos/Runner/Assets.xcassets/AppIcon.appiconset/Contents.json
macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_1024.png
macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_128.png
macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_16.png
macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_256.png
macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_32.png
macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_512.png
macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_64.png
macos/Runner/Base.lproj/MainMenu.xib
macos/Runner/Configs/AppInfo.xcconfig
macos/Runner/Configs/Debug.xcconfig
macos/Runner/Configs/Release.xcconfig
macos/Runner/Configs/Warnings.xcconfig
macos/Runner/DebugProfile.entitlements
macos/Runner/Info.plist
macos/Runner/MainFlutterWindow.swift
macos/Runner/Release.entitlements
macos/RunnerTests/RunnerTests.swift
ml/AI_TRAINER_SERVER_CONTRACT.md
ml/HARD_NEGATIVES_BUILD127.md
ml/V3_BENCHMARK_20260921.md
ml/V3_MULTIHEAD_REAL_IMAGE_AUDIT_20260922.md
ml/V3_PHOTO_RESIDUAL_CANDIDATE_20260922.md
ml/hard_negative_sets/build127_texture_hard_negatives_20260921.json
ml/hard_negative_sets/build127_training_corpus_final_v1.json
ml/photo_framing_fused_head_fp16.b85
ml/prepare_dataset.py
ml/requirements.txt
ml/sigillum_photo_framing_v1_PARITY.json
ml/test_prepare_dataset_hard_negatives.py
ml/train_tflite.py
ml/v3/convert_v3_to_tflite.py
ml/v3/v3_hard_negative_head_172a_fp16.json
ml/v3/v3_multihead_tflite_manifest.json
ml/v3/v3_multihead_weights_fp16.json
ml/v3/v3_parity_vectors.json
ml/v3_export/v3_dualbranch_litert_parity.json
node_modules/.bin/prebuild-install
node_modules/.bin/prebuild-install.cmd
node_modules/.bin/prebuild-install.ps1
node_modules/.bin/rc
node_modules/.bin/rc.cmd
node_modules/.bin/rc.ps1
node_modules/.bin/semver
node_modules/.bin/semver.cmd
node_modules/.bin/semver.ps1
node_modules/.package-lock.json
node_modules/base64-js/LICENSE
node_modules/base64-js/README.md
node_modules/base64-js/base64js.min.js
node_modules/base64-js/index.d.ts
node_modules/base64-js/index.js
node_modules/base64-js/package.json
node_modules/better-sqlite3/LICENSE
node_modules/better-sqlite3/README.md
node_modules/better-sqlite3/binding.gyp
node_modules/better-sqlite3/build/Release/better_sqlite3.node
node_modules/better-sqlite3/deps/common.gypi
node_modules/better-sqlite3/deps/copy.js
node_modules/better-sqlite3/deps/defines.gypi
node_modules/better-sqlite3/deps/download.sh
node_modules/better-sqlite3/deps/patches/1208.patch
node_modules/better-sqlite3/deps/sqlite3.gyp
node_modules/better-sqlite3/deps/sqlite3/sqlite3.c
node_modules/better-sqlite3/deps/sqlite3/sqlite3.h
node_modules/better-sqlite3/deps/sqlite3/sqlite3ext.h
node_modules/better-sqlite3/deps/test_extension.c
node_modules/better-sqlite3/lib/database.js
node_modules/better-sqlite3/lib/index.js
node_modules/better-sqlite3/lib/methods/aggregate.js
node_modules/better-sqlite3/lib/methods/backup.js
node_modules/better-sqlite3/lib/methods/function.js
node_modules/better-sqlite3/lib/methods/inspect.js
node_modules/better-sqlite3/lib/methods/pragma.js
node_modules/better-sqlite3/lib/methods/serialize.js
node_modules/better-sqlite3/lib/methods/table.js
node_modules/better-sqlite3/lib/methods/transaction.js
node_modules/better-sqlite3/lib/methods/wrappers.js
node_modules/better-sqlite3/lib/sqlite-error.js
node_modules/better-sqlite3/lib/util.js
node_modules/better-sqlite3/package.json
node_modules/better-sqlite3/src/addon.cpp
node_modules/better-sqlite3/src/better_sqlite3.cpp
node_modules/better-sqlite3/src/objects/backup.cpp
node_modules/better-sqlite3/src/objects/backup.hpp
node_modules/better-sqlite3/src/objects/database.cpp
node_modules/better-sqlite3/src/objects/database.hpp
node_modules/better-sqlite3/src/objects/statement-iterator.cpp
node_modules/better-sqlite3/src/objects/statement-iterator.hpp
node_modules/better-sqlite3/src/objects/statement.cpp
node_modules/better-sqlite3/src/objects/statement.hpp
node_modules/better-sqlite3/src/util/bind-map.cpp
node_modules/better-sqlite3/src/util/binder.cpp
node_modules/better-sqlite3/src/util/constants.cpp
node_modules/better-sqlite3/src/util/custom-aggregate.cpp
node_modules/better-sqlite3/src/util/custom-function.cpp
node_modules/better-sqlite3/src/util/custom-table.cpp
node_modules/better-sqlite3/src/util/data-converter.cpp
node_modules/better-sqlite3/src/util/data.cpp
node_modules/better-sqlite3/src/util/helpers.cpp
node_modules/better-sqlite3/src/util/macros.cpp
node_modules/better-sqlite3/src/util/query-macros.cpp
node_modules/better-sqlite3/src/util/row-builder.cpp
node_modules/bindings/LICENSE.md
node_modules/bindings/README.md
node_modules/bindings/bindings.js
node_modules/bindings/package.json
node_modules/bl/.travis.yml
node_modules/bl/BufferList.js
node_modules/bl/LICENSE.md
node_modules/bl/README.md
node_modules/bl/bl.js
node_modules/bl/package.json
node_modules/bl/test/convert.js
node_modules/bl/test/indexOf.js
node_modules/bl/test/isBufferList.js
node_modules/bl/test/test.js
node_modules/buffer/AUTHORS.md
node_modules/buffer/LICENSE
node_modules/buffer/README.md
node_modules/buffer/index.d.ts
node_modules/buffer/index.js
node_modules/buffer/package.json
node_modules/chownr/LICENSE
node_modules/chownr/README.md
node_modules/chownr/chownr.js
node_modules/chownr/package.json
node_modules/decompress-response/index.d.ts
node_modules/decompress-response/index.js
node_modules/decompress-response/license
node_modules/decompress-response/package.json
node_modules/decompress-response/readme.md
node_modules/deep-extend/CHANGELOG.md
node_modules/deep-extend/LICENSE
node_modules/deep-extend/README.md
node_modules/deep-extend/index.js
node_modules/deep-extend/lib/deep-extend.js
node_modules/deep-extend/package.json
node_modules/detect-libc/LICENSE
node_modules/detect-libc/README.md
node_modules/detect-libc/index.d.ts
node_modules/detect-libc/lib/detect-libc.js
node_modules/detect-libc/lib/elf.js
node_modules/detect-libc/lib/filesystem.js
node_modules/detect-libc/lib/process.js
node_modules/detect-libc/package.json
node_modules/end-of-stream/LICENSE
node_modules/end-of-stream/README.md
node_modules/end-of-stream/index.js
node_modules/end-of-stream/package.json
node_modules/expand-template/.travis.yml
node_modules/expand-template/LICENSE
node_modules/expand-template/README.md
node_modules/expand-template/index.js
node_modules/expand-template/package.json
node_modules/expand-template/test.js
node_modules/file-uri-to-path/.npmignore
node_modules/file-uri-to-path/.travis.yml
node_modules/file-uri-to-path/History.md
node_modules/file-uri-to-path/LICENSE
node_modules/file-uri-to-path/README.md
node_modules/file-uri-to-path/index.d.ts
node_modules/file-uri-to-path/index.js
node_modules/file-uri-to-path/package.json
node_modules/file-uri-to-path/test/test.js
node_modules/file-uri-to-path/test/tests.json
node_modules/fs-constants/LICENSE
node_modules/fs-constants/README.md
node_modules/fs-constants/browser.js
node_modules/fs-constants/index.js
node_modules/fs-constants/package.json
node_modules/github-from-package/.travis.yml
node_modules/github-from-package/LICENSE
node_modules/github-from-package/example/package.json
node_modules/github-from-package/example/url.js
node_modules/github-from-package/index.js
node_modules/github-from-package/package.json
node_modules/github-from-package/readme.markdown
node_modules/github-from-package/test/a.json
node_modules/github-from-package/test/b.json
node_modules/github-from-package/test/c.json
node_modules/github-from-package/test/d.json
node_modules/github-from-package/test/e.json
node_modules/github-from-package/test/url.js
node_modules/ieee754/LICENSE
node_modules/ieee754/README.md
node_modules/ieee754/index.d.ts
node_modules/ieee754/index.js
node_modules/ieee754/package.json
node_modules/inherits/LICENSE
node_modules/inherits/README.md
node_modules/inherits/inherits.js
node_modules/inherits/inherits_browser.js
node_modules/inherits/package.json
node_modules/ini/LICENSE
node_modules/ini/README.md
node_modules/ini/ini.js
node_modules/ini/package.json
node_modules/mimic-response/index.d.ts
node_modules/mimic-response/index.js
node_modules/mimic-response/license
node_modules/mimic-response/package.json
node_modules/mimic-response/readme.md
node_modules/minimist/.eslintrc
node_modules/minimist/.github/FUNDING.yml
node_modules/minimist/.nycrc
node_modules/minimist/CHANGELOG.md
node_modules/minimist/LICENSE
node_modules/minimist/README.md
node_modules/minimist/example/parse.js
node_modules/minimist/index.js
node_modules/minimist/package.json
node_modules/minimist/test/all_bool.js
node_modules/minimist/test/bool.js
node_modules/minimist/test/dash.js
node_modules/minimist/test/default_bool.js
node_modules/minimist/test/dotted.js
node_modules/minimist/test/kv_short.js
node_modules/minimist/test/long.js
node_modules/minimist/test/num.js
node_modules/minimist/test/parse.js
node_modules/minimist/test/parse_modified.js
node_modules/minimist/test/proto.js
node_modules/minimist/test/short.js
node_modules/minimist/test/stop_early.js
node_modules/minimist/test/unknown.js
node_modules/minimist/test/whitespace.js
node_modules/mkdirp-classic/LICENSE
node_modules/mkdirp-classic/README.md
node_modules/mkdirp-classic/index.js
node_modules/mkdirp-classic/package.json
node_modules/napi-build-utils/.github/workflows/run-npm-tests.yml
node_modules/napi-build-utils/LICENSE
node_modules/napi-build-utils/README.md
node_modules/napi-build-utils/index.js
node_modules/napi-build-utils/index.md
node_modules/napi-build-utils/package.json
node_modules/node-abi/LICENSE
node_modules/node-abi/README.md
node_modules/node-abi/abi_registry.json
node_modules/node-abi/index.js
node_modules/node-abi/package.json
node_modules/once/LICENSE
node_modules/once/README.md
node_modules/once/once.js
node_modules/once/package.json
node_modules/prebuild-install/CHANGELOG.md
node_modules/prebuild-install/CONTRIBUTING.md
node_modules/prebuild-install/LICENSE
node_modules/prebuild-install/README.md
node_modules/prebuild-install/asset.js
node_modules/prebuild-install/bin.js
node_modules/prebuild-install/download.js
node_modules/prebuild-install/error.js
node_modules/prebuild-install/help.txt
node_modules/prebuild-install/index.js
node_modules/prebuild-install/log.js
node_modules/prebuild-install/package.json
node_modules/prebuild-install/proxy.js
node_modules/prebuild-install/rc.js
node_modules/prebuild-install/util.js
node_modules/pump/.github/FUNDING.yml
node_modules/pump/.travis.yml
node_modules/pump/LICENSE
node_modules/pump/README.md
node_modules/pump/SECURITY.md
node_modules/pump/empty.js
node_modules/pump/index.js
node_modules/pump/package.json
node_modules/pump/test-browser.js
node_modules/pump/test-node.js
node_modules/rc/LICENSE.APACHE2
node_modules/rc/LICENSE.BSD
node_modules/rc/LICENSE.MIT
node_modules/rc/README.md
node_modules/rc/browser.js
node_modules/rc/cli.js
node_modules/rc/index.js
node_modules/rc/lib/utils.js
node_modules/rc/package.json
node_modules/rc/test/ini.js
node_modules/rc/test/nested-env-vars.js
node_modules/rc/test/test.js
node_modules/readable-stream/CONTRIBUTING.md
node_modules/readable-stream/GOVERNANCE.md
node_modules/readable-stream/LICENSE
node_modules/readable-stream/README.md
node_modules/readable-stream/errors-browser.js
node_modules/readable-stream/errors.js
node_modules/readable-stream/experimentalWarning.js
node_modules/readable-stream/lib/_stream_duplex.js
node_modules/readable-stream/lib/_stream_passthrough.js
node_modules/readable-stream/lib/_stream_readable.js
node_modules/readable-stream/lib/_stream_transform.js
node_modules/readable-stream/lib/_stream_writable.js
node_modules/readable-stream/lib/internal/streams/async_iterator.js
node_modules/readable-stream/lib/internal/streams/buffer_list.js
node_modules/readable-stream/lib/internal/streams/destroy.js
node_modules/readable-stream/lib/internal/streams/end-of-stream.js
node_modules/readable-stream/lib/internal/streams/from-browser.js
node_modules/readable-stream/lib/internal/streams/from.js
node_modules/readable-stream/lib/internal/streams/pipeline.js
node_modules/readable-stream/lib/internal/streams/state.js
node_modules/readable-stream/lib/internal/streams/stream-browser.js
node_modules/readable-stream/lib/internal/streams/stream.js
node_modules/readable-stream/package.json
node_modules/readable-stream/readable-browser.js
node_modules/readable-stream/readable.js
node_modules/safe-buffer/LICENSE
node_modules/safe-buffer/README.md
node_modules/safe-buffer/index.d.ts
node_modules/safe-buffer/index.js
node_modules/safe-buffer/package.json
node_modules/semver/LICENSE
node_modules/semver/README.md
node_modules/semver/bin/semver.js
node_modules/semver/classes/comparator.js
node_modules/semver/classes/index.js
node_modules/semver/classes/range.js
node_modules/semver/classes/semver.js
node_modules/semver/functions/clean.js
node_modules/semver/functions/cmp.js
node_modules/semver/functions/coerce.js
node_modules/semver/functions/compare-build.js
node_modules/semver/functions/compare-loose.js
node_modules/semver/functions/compare.js
node_modules/semver/functions/diff.js
node_modules/semver/functions/eq.js
node_modules/semver/functions/gt.js
node_modules/semver/functions/gte.js
node_modules/semver/functions/inc.js
node_modules/semver/functions/lt.js
node_modules/semver/functions/lte.js
node_modules/semver/functions/major.js
node_modules/semver/functions/minor.js
node_modules/semver/functions/neq.js
node_modules/semver/functions/parse.js
node_modules/semver/functions/patch.js
node_modules/semver/functions/prerelease.js
node_modules/semver/functions/rcompare.js
node_modules/semver/functions/rsort.js
node_modules/semver/functions/satisfies.js
node_modules/semver/functions/sort.js
node_modules/semver/functions/truncate.js
node_modules/semver/functions/valid.js
node_modules/semver/index.js
node_modules/semver/internal/constants.js
node_modules/semver/internal/debug.js
node_modules/semver/internal/identifiers.js
node_modules/semver/internal/lrucache.js
node_modules/semver/internal/parse-options.js
node_modules/semver/internal/re.js
node_modules/semver/package.json
node_modules/semver/preload.js
node_modules/semver/range.bnf
node_modules/semver/ranges/gtr.js
node_modules/semver/ranges/intersects.js
node_modules/semver/ranges/ltr.js
node_modules/semver/ranges/max-satisfying.js
node_modules/semver/ranges/min-satisfying.js
node_modules/semver/ranges/min-version.js
node_modules/semver/ranges/outside.js
node_modules/semver/ranges/simplify.js
node_modules/semver/ranges/subset.js
node_modules/semver/ranges/to-comparators.js
node_modules/semver/ranges/valid.js
node_modules/simple-concat/.travis.yml
node_modules/simple-concat/LICENSE
node_modules/simple-concat/README.md
node_modules/simple-concat/index.js
node_modules/simple-concat/package.json
node_modules/simple-concat/test/basic.js
node_modules/simple-get/.github/dependabot.yml
node_modules/simple-get/.github/workflows/ci.yml
node_modules/simple-get/LICENSE
node_modules/simple-get/README.md
node_modules/simple-get/index.js
node_modules/simple-get/package.json
node_modules/string_decoder/LICENSE
node_modules/string_decoder/README.md
node_modules/string_decoder/lib/string_decoder.js
node_modules/string_decoder/package.json
node_modules/strip-json-comments/index.js
node_modules/strip-json-comments/license
node_modules/strip-json-comments/package.json
node_modules/strip-json-comments/readme.md
node_modules/tar-fs/.travis.yml
node_modules/tar-fs/LICENSE
node_modules/tar-fs/README.md
node_modules/tar-fs/index.js
node_modules/tar-fs/package.json
node_modules/tar-fs/test/fixtures/a/hello.txt
node_modules/tar-fs/test/fixtures/b/a/test.txt
node_modules/tar-fs/test/fixtures/d/file1
node_modules/tar-fs/test/fixtures/d/file2
node_modules/tar-fs/test/fixtures/d/sub-dir/file5
node_modules/tar-fs/test/fixtures/d/sub-files/file3
node_modules/tar-fs/test/fixtures/d/sub-files/file4
node_modules/tar-fs/test/fixtures/e/directory/.ignore
node_modules/tar-fs/test/fixtures/e/file
node_modules/tar-fs/test/fixtures/invalid.tar
node_modules/tar-fs/test/index.js
node_modules/tar-stream/LICENSE
node_modules/tar-stream/README.md
node_modules/tar-stream/extract.js
node_modules/tar-stream/headers.js
node_modules/tar-stream/index.js
node_modules/tar-stream/pack.js
node_modules/tar-stream/package.json
node_modules/tar-stream/sandbox.js
node_modules/tunnel-agent/LICENSE
node_modules/tunnel-agent/README.md
node_modules/tunnel-agent/index.js
node_modules/tunnel-agent/package.json
node_modules/util-deprecate/History.md
node_modules/util-deprecate/LICENSE
node_modules/util-deprecate/README.md
node_modules/util-deprecate/browser.js
node_modules/util-deprecate/node.js
node_modules/util-deprecate/package.json
node_modules/wrappy/LICENSE
node_modules/wrappy/README.md
node_modules/wrappy/package.json
node_modules/wrappy/wrappy.js
package-lock.json
package.json
pubspec.lock
pubspec.yaml
test/account_page_contract_test.dart
test/account_success_feedback_contract_test.dart
test/active_probe_v4_contract_test.dart
test/active_probe_zoom_wait_contract_test.dart
test/apple_current_entitlement_reconciliation_contract_test.dart
test/apple_foreign_entitlement_purchase_preflight_contract_test.dart
test/archive15_display_risk_test.dart
test/archive17_display_risk_test.dart
test/archive18_display_risk_test.dart
test/archive19_flash_response_test.dart
test/archive20_scene_policy_test.dart
test/archive42_reality_active_probe_regression_test.dart
test/build109_low_modulation_hfr_recovery_test.dart
test/build109_ml_fullframe_recovery_test.dart
test/build111_photo_monitor_regression_test.dart
test/build112_photo_optical_corroboration_test.dart
test/build112_social_fingerprint_failclosed_test.dart
test/build113_audio_fingerprint_test.dart
test/build113_copy_localization_contract_test.dart
test/build115_reflection_semantic_resolution_test.dart
test/build116_bmw_display_hfr_mixedscene_test.dart
test/build117_scene_context_architecture_test.dart
test/build118_photo_preview_highres_contract_test.dart
test/build119_photo_preview_rotation_contract_test.dart
test/build120_passive_scene_context_activation_test.dart
test/build121_unified_photo_scene_context_test.dart
test/build122_corpus_wide_recovery_test.dart
test/build123_context_free_display_policy_test.dart
test/build124_multi_evidence_display_policy_test.dart
test/build125_fov_comparability_guard_test.dart
test/build125_zoom_coherent_hfr_test.dart
test/build126_video_fov_persistence_test.dart
test/build127_archive90_video_lattice_regression_test.dart
test/build127_ml_hard_negative_training_contract_test.dart
test/build127_physical_texture_lattice_guard_test.dart
test/build127_v3_photo_residual_28case_gate_test.dart
test/build127_v3_photo_residual_policy_test.dart
test/build128_derivative_integrity_spatial_v2_test.dart
test/build128_original_hard_binding_fail_closed_test.dart
test/build128_photo_video_preview_fov_parity_test.dart
test/build133_live_reference_and_recovery_contract_test.dart
test/build133_release_hardening_contract_test.dart
test/build136_field_regression_contract_test.dart
test/build137_text_scene_ux_contract_test.dart
test/build139_r2_primary_reference_contract_test.dart
test/build142_r2_manual_compare_contract_test.dart
test/build143_authorized_subtitle_derivation_contract_test.dart
test/build144_prelaunch_hardening_test.dart
test/build145_social_verification_recovery_test.dart
test/build146_text_verification_entry_test.dart
test/build147_gps_photo_integrity_test.dart
test/build148_photo_microtamper_test.dart
test/build149_authorized_derivative_scene_result_test.dart
test/build149_product_communication_contract_test.dart
test/build65_display_recall_regression_test.dart
test/build66_planar_multiframe_regression_test.dart
test/build67_reality_regression_test.dart
test/build69_capture_fusion_integration_test.dart
test/build71_video_semantic_persistence_regression_test.dart
test/build72_verification_scene_copy_contract_test.dart
test/build72_video_reality_and_container_regression_test.dart
test/build73_video_screen_persistence_v2_regression_test.dart
test/build74_fusion_regression_test.dart
test/build96_login_quickverify_regression_contract_test.dart
test/c8ff_regression_contract_test.dart
test/camera_focus_recovery_after_native_probe_test.dart
test/camera_physical_scene_contract_test.dart
test/camera_ready_video_evidence_contract_test.dart
test/capture_location_contract_test.dart
test/commercial_api_transport_contract_test.dart
test/commercial_billing_fresh_server_status_test.dart
test/commercial_billing_server_verification_contract_test.dart
test/commercial_registration_timeout_contract_test.dart
test/commercial_ux_kyc_identity_contract_test.dart
test/creator_entitlement_revalidation_contract_test.dart
test/creator_weekly_subscription_contract_test.dart
test/current_device_monitor_recall_regression_test.dart
test/device_revocation_ui_contract_test.dart
test/display_risk_policy_v4_test.dart
test/display_signature_matrix_test.dart
test/dual_display_reality_evidence_v1_test.dart
test/fast_uncertified_media_precheck_contract_test.dart
test/final_localization_hardening_test.dart
test/final_video_ui_paywall_contract_test.dart
test/foreign_storekit_stale_transaction_contract_test.dart
test/free_photo_reference_verification_contract_test.dart
test/frequency_probe_session_safety_contract_test.dart
test/geometry_not_absolute_proof_test.dart
test/hcv_active_display_classifier_test.dart
test/hcv_active_display_fusion_test.dart
test/hcv_capture_provenance_test.dart
test/hcv_capture_provenance_verifier_test.dart
test/hcv_capture_timestamp_test.dart
test/hcv_display_risk_conflict_regression_test.dart
test/hcv_display_risk_fusion_test.dart
test/hcv_engine_capture_provenance_contract_test.dart
test/hcv_id_format_test.dart
test/hcv_id_lookup_contract_test.dart
test/hcv_media_id_ocr_test.dart
test/hcv_planar_motion_model_test.dart
test/hcv_projective_motion_model_test.dart
test/hcv_provenance_chain_test.dart
test/hcv_registry_provenance_gate_contract_test.dart
test/hcv_scene_decision_fusion_test.dart
test/hcv_scene_geometry_classifier_test.dart
test/hcv_software_attestation_contract_test.dart
test/hcv_software_attestation_test.dart
test/hcv_software_attestation_verifier_test.dart
test/hcv_text_integrity_test.dart
test/hcv_trust_analyzer_standard_test.dart
test/hcvpack_integrity_release_gate_test.dart
test/hfr_coherent_display_periodicity_gate_test.dart
test/hfr_coherent_display_periodicity_integration_contract_test.dart
test/hfr_v31_advanced_probe_contract_test.dart
test/hfr_v32_harmonic_reality_physics_test.dart
test/hfr_v3_fullframe_mixed_scene_test.dart
test/ios_document_open_contract_test.dart
test/ios_photo_picker_lifecycle_contract_test.dart
test/ios_photo_picker_limited_access_fallback_contract_test.dart
test/ios_share_handoff_contract_test.dart
test/ios_video_watermark_archive42_contract_test.dart
test/kyc_recovery_contract_test.dart
test/live_probe_geometry_fields_test.dart
test/media_specific_verification_picker_contract_test.dart
test/messenger_mlkit_image_preflight_contract_test.dart
test/mixed_scene_monitor_regression_test.dart
test/ml_calibration_corpus_v1_test.dart
test/monitor_certificate_regression_test.dart
test/monitor_corroboration_policy_test.dart
test/native_storefront_price_contract_test.dart
test/native_temporal_frequency_focus_handoff_contract_test.dart
test/native_temporal_frequency_v2_contract_test.dart
test/native_temporal_frequency_v2_crash_hotfix_contract_test.dart
test/native_temporal_frequency_v2_hfr_range_contract_test.dart
test/no_capture_submode_claims_test.dart
test/no_strong_geometry_only_test.dart
test/official_reference_v3_contract_test.dart
test/paywall_native_storefront_contract_test.dart
test/phase_c_48_case_promotion_matrix_test.dart
test/phase_c_ml_geometry_persistence_regression_test.dart
test/photo_detail_compare_v4_test.dart
test/photo_display_risk_policy_test.dart
test/photo_framing_embedded_context_guard_test.dart
test/photo_hfr_partial_conflict_guard_test.dart
test/photo_ml_first_threshold_080_regression_test.dart
test/photo_ocr_registry_recovery_contract_test.dart
test/photo_pre_capture_only_contract_test.dart
test/photo_quick_negative_latency_contract_test.dart
test/photo_semantic_capture_isolation_test.dart
test/photo_semantic_framing_contract_test.dart
test/photo_semantic_framing_tflite_asset_test.dart
test/photo_semantic_opencv_preprocessing_parity_test.dart
test/photo_temporal_fast_contract_test.dart
test/photo_temporal_four_frame_sampling_contract_test.dart
test/photo_temporal_v2_c8ff_regression_test.dart
test/photo_video_equivalent_method_test.dart
test/photo_visual_framing_diagnostic_test.dart
test/physical_probe_user_instruction_test.dart
test/physical_scene_claims_photo_video_test.dart
test/physical_scene_decision_schema_test.dart
test/physical_scene_evidence_schema_test.dart
test/planarity_safety_test.dart
test/prelaunch_initial_scene_ui_paywall_contract_test.dart
test/prelaunch_legal_localization_contract_test.dart
test/prelaunch_product_refinement_contract_test.dart
test/prelaunch_rc2_regression_20260825_test.dart
test/prelaunch_ui_camera_refinement_contract_test.dart
test/prelaunch_usability_subtitle_account_contract_test.dart
test/prelaunch_verification_registry_regression_20260824_test.dart
test/prelaunch_visual_caption_refinement_contract_test.dart
test/probe_duration_contract_test.dart
test/profile_language_sync_contract_test.dart
test/public_home_unpaid_restore_contract_test.dart
test/quick_hcv_media_gate_contract_test.dart
test/rc2_installed_runtime_regression_contract_test.dart
test/rc2_photo_integrity_contract_test.dart
test/rc2_real_world_decision_regression_test.dart
test/rc2_verification_scene_priority_contract_test.dart
test/reality_override_threshold_test.dart
test/reality_temporal_false_positive_regression_test.dart
test/reference_visual_fingerprint_v3_test.dart
test/reflective_planar_ml_guard_regression_test.dart
test/registry_display_risk_claims_test.dart
test/registry_first_capture_race_contract_test.dart
test/registry_local_republish_contract_test.dart
test/registry_subscription_expiry_retry_contract_test.dart
test/registry_transient_retry_regression_test.dart
test/registry_verify_hcv_id16_contract_test.dart
test/save_original_reference_first_test.dart
test/scene_class_values_test.dart
test/scene_decision_values_test.dart
test/scene_geometry_thresholds_test.dart
test/server_creator_id_sync_contract_test.dart
test/share_extension_localization_and_reference_copy_test.dart
test/shared_media_cold_start_contract_test.dart
test/storefront_price_fail_closed_contract_test.dart
test/storefront_price_stability_contract_test.dart
test/storefront_session_freshness_contract_test.dart
test/storekit_cancel_retry_terminal_contract_test.dart
test/storekit_localized_price_contract_test.dart
test/storekit_transaction_lifecycle_contract_test.dart
test/storekit_user_safe_error_copy_test.dart
test/subtitle_tail_coverage_contract_test.dart
test/temporal_frequency_probe_contract_test.dart
test/testflight_ml_release_contract_test.dart
test/text_keyboard_registry_photo_arm_contract_test.dart
test/text_social_workflow_contract_test.dart
test/v3_hard_negative_172a_gate_test.dart
test/verification_clarity_localization_ml_contract_test.dart
test/verification_color_semantics_test.dart
test/verification_visual_consistency_contract_test.dart
test/verified_originals_reference_test.dart
test/verified_originals_v2_contract_test.dart
test/video_geometry_ml_conflict_guard_test.dart
test/video_initial_scene_policy_test.dart
test/video_ml_adaptive_sampling_contract_test.dart
test/video_native_capture_writer_stability_contract_test.dart
test/video_photo_spatial_evidence_test.dart
test/video_photo_spatial_fusion_test.dart
test/video_transcription_full_coverage_contract_test.dart
test/weak_semantic_no_physical_resolution_test.dart
test/weekly_duplicate_storekit_preflight_contract_test.dart
test/weekly_entitlement_settle_regression_test.dart
test/zoom_restore_contract_test.dart
tool/README_materialization_20260826.md
tool/apply_account_success_feedback.py
tool/apply_camera_localization_finalizer_20260825.py
tool/apply_certificate_contract_test_fix.py
tool/apply_certificate_regression_behavior_fix.py
tool/apply_certificate_regression_compile_fix.py
tool/apply_certificate_regression_fix.py
tool/apply_commercial_profile_shell.py
tool/apply_commercial_registry_auth.py
tool/apply_creator_weekly_subscription_20260826.py
tool/apply_e2e_video_livesignals_polish_20260819.py
tool/apply_fast_uncertified_media_precheck_20260823.py
tool/apply_file_import_and_ocr_fix.py
tool/apply_ios_share_handoff_fix.py
tool/apply_media_specific_verification_picker_fix_20260822.py
tool/apply_mixed_scene_monitor_fix.py
tool/apply_ml_ios_runtime_finalizer_20260825.py
tool/apply_planar_parallax_compile_safety.py
tool/apply_prelaunch_account_help_refinement_20260818.py
tool/apply_prelaunch_camera_files_subtitle_ui_fix_20260818.py
tool/apply_prelaunch_camera_generated_escape_fix_20260818.py
tool/apply_prelaunch_landing_localization_20260818.py
tool/apply_prelaunch_landing_visual_compile_fix.py
tool/apply_prelaunch_landing_visual_match.py
tool/apply_prelaunch_legal_localization_20260818.py
tool/apply_prelaunch_legal_localization_compile_guard_20260818.py
tool/apply_prelaunch_legal_localization_visual_anchor_20260818.py
tool/apply_prelaunch_proceed_anchor_normalization.py
tool/apply_prelaunch_product_refinement_20260817.py
tool/apply_prelaunch_product_refinement_contract_fix.py
tool/apply_prelaunch_speech_recognition_robustness_20260818.py
tool/apply_prelaunch_ui_camera_refinement.py
tool/apply_prelaunch_user_language_help_refinement_20260818.py
tool/apply_prelaunch_ux_kyc_identity_fix.py
tool/apply_prelaunch_visual_caption_refinement_20260818.py
tool/apply_public_home_unpaid_restore_fix_20260822.py
tool/apply_rc2_decision_architecture_fix_20260825.py
tool/apply_rc2_decision_architecture_fix_legacy_20260825.py
tool/apply_rc2_definitive_build_finalizer_20260825.py
tool/apply_rc2_definitive_build_finalizer_legacy_20260825.py
tool/apply_rc2_ios_original_photo_picker_finalizer_20260825.py
tool/apply_rc2_native_storefront_price_finalizer_20260826.py
tool/apply_rc2_photo_integrity_finalizer_20260825.py
tool/apply_rc2_photo_integrity_wrapper_20260825.py
tool/apply_rc2_photo_package_camera_finalizer_20260825.py
tool/apply_rc2_photo_package_import_finalizer_20260825.py
tool/apply_rc2_photo_parallax_and_media_verify_finalizer_20260825.py
tool/apply_rc2_policy_test_alignment_20260825.py
tool/apply_rc2_runtime_regressions_finalizer_20260826.py
tool/apply_rc2_verification_scene_priority_finalizer_20260826.py
tool/apply_registry_full_diagnostics_20260825.py
tool/apply_registry_read_compatibility_20260824.py
tool/apply_safe_capture_location_fix.py
tool/apply_server_verified_billing_gate.py
tool/apply_storekit_localized_price_ui_fix_20260826.py
tool/apply_storekit_transaction_lifecycle_fix_20260821.py
tool/apply_text_keyboard_registry_photo_arm_fix.py
tool/apply_text_social_verification.py
tool/apply_verification_clarity_localization_ml_fix_20260824.py
tool/apply_verification_compile_contract_finalizer_20260824.py
tool/apply_verification_language_finalizer_20260824.py
tool/apply_verification_registry_finalizer_20260824.py
tool/apply_verification_result_copy_finalizer_20260824.py
tool/apply_verification_severity_colors_20260824.py
tool/build_testflight_ipa_rc2_20260825.sh
tool/convert_v3_dualbranch_litert.py
tool/diagnose_tflite_models_20260825.py
tool/finalize_testflight_release_source_20260825.py
tool/normalize_camera_localization_anchors_20260825.py
tool/normalize_capture_ready_dialog_for_localization_20260825.py
tool/normalize_rc2_finalizer_idempotence_20260826.py
tool/normalize_registry_helper_20260825.py
tool/normalize_registry_initial_status_20260825.py
tool/pin_tflite_ios_runtime_20260826.sh
tool/prepare_prelaunch_visual_caption_refinement_20260818.py
tool/run_ios_share_handoff_fix.py
tool/run_prelaunch_visual_caption_refinement_20260818.py
tool/validate_display_fusion.dart
tool/verify_materialized_source_commit_20260826.py
tool/verify_postpatch_release_20260825.py
web/favicon.png
web/icons/Icon-192.png
web/icons/Icon-512.png
web/icons/Icon-maskable-192.png
web/icons/Icon-maskable-512.png
web/index.html
web/manifest.json
windows/.gitignore
windows/CMakeLists.txt
windows/flutter/CMakeLists.txt
windows/flutter/generated_plugin_registrant.cc
windows/flutter/generated_plugin_registrant.h
windows/flutter/generated_plugins.cmake
windows/runner/CMakeLists.txt
windows/runner/Runner.rc
windows/runner/flutter_window.cpp
windows/runner/flutter_window.h
windows/runner/main.cpp
windows/runner/resource.h
windows/runner/resources/app_icon.ico
windows/runner/runner.exe.manifest
windows/runner/utils.cpp
windows/runner/utils.h
windows/runner/win32_window.cpp
windows/runner/win32_window.h
```

### Source dependency edges

```text
MODIFICHE/camera_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:flutter/services.dart, package:camera/camera.dart, package:crypto/crypto.dart, package:path/path.dart, package:share_plus/share_plus.dart, hcv_engine.dart, hcv_verifier.dart, hcv_package.dart, hcv_registry_service.dart, hcv_live_signals.dart, hcv_trust_analyzer.dart
MODIFICHE/camera_service.dart -> package:flutter/foundation.dart
MODIFICHE/hcv_crypto.dart -> dart:convert, dart:typed_data, package:cryptography/cryptography.dart
MODIFICHE/hcv_engine.dart -> dart:convert, dart:io, dart:math, dart:typed_data, package:crypto/crypto.dart, package:path_provider/path_provider.dart, package:path/path.dart, package:uuid/uuid.dart, package:pointycastle/export.dart, package:shared_preferences/shared_preferences.dart, hcv_identity.dart
MODIFICHE/hcv_identity.dart -> dart:convert, package:crypto/crypto.dart, package:shared_preferences/shared_preferences.dart, package:uuid/uuid.dart
MODIFICHE/hcv_import_router_page.dart -> dart:io, package:flutter/material.dart, hcvpack_player_page.dart, verify_page.dart, registry_verify_page.dart
MODIFICHE/hcv_live_signals.dart -> dart:async, dart:math, package:sensors_plus/sensors_plus.dart
MODIFICHE/hcv_package.dart -> dart:convert, dart:io, package:archive/archive_io.dart, package:crypto/crypto.dart, package:path/path.dart
MODIFICHE/hcv_registry_service.dart -> dart:convert, dart:io
MODIFICHE/hcv_verifier.dart -> dart:convert, dart:io, dart:typed_data, package:crypto/crypto.dart, package:pointycastle/export.dart
MODIFICHE/hcv_video_watermark.dart -> dart:io, package:path/path.dart
MODIFICHE/hcvpack_player_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:media_kit/media_kit.dart, package:media_kit_video/media_kit_video.dart, package:crypto/crypto.dart, package:archive/archive.dart, package:path_provider/path_provider.dart, package:path/path.dart, hcv_verifier.dart
MODIFICHE/home_page.dart -> package:flutter/material.dart, package:flutter/services.dart, camera_page.dart, hcvpack_player_page.dart, hcv_import_router_page.dart, import_page.dart, identity_page.dart, text_cert_page.dart, registry_verify_page.dart
MODIFICHE/import_page.dart -> package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_import_router_page.dart
MODIFICHE/main.dart -> package:flutter/material.dart, package:media_kit/media_kit.dart, home_page.dart
MODIFICHE/registry_verify_page.dart -> dart:convert, dart:io, package:crypto/crypto.dart, package:file_picker/file_picker.dart, package:flutter/material.dart, package:path_provider/path_provider.dart, hcv_registry_service.dart, hcv_verifier.dart
MODIFICHE/text_cert_page.dart -> dart:convert, dart:io, package:crypto/crypto.dart, package:flutter/material.dart, package:flutter/services.dart, package:path/path.dart, package:share_plus/share_plus.dart, hcv_engine.dart, hcv_verifier.dart, hcv_registry_service.dart
MODIFICHE/verifier_page.dart -> dart:convert, dart:io, package:crypto/crypto.dart
MODIFICHE/verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_verifier.dart
MODIFICHE/video_player_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, package:video_player/video_player.dart, hcv_verifier.dart
MODIFICHE/video_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE  LOCALE 5/camera_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:flutter/services.dart, package:camera/camera.dart, package:crypto/crypto.dart, package:path/path.dart, package:share_plus/share_plus.dart, hcv_engine.dart, hcv_verifier.dart, hcv_package.dart, hcv_registry_service.dart, hcv_live_signals.dart, hcv_trust_analyzer.dart
VERSIONE FUNZIONANTE  LOCALE 5/camera_service.dart -> package:flutter/foundation.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_crypto.dart -> dart:convert, dart:typed_data, package:cryptography/cryptography.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_engine.dart -> dart:convert, dart:io, dart:math, dart:typed_data, package:crypto/crypto.dart, package:path_provider/path_provider.dart, package:path/path.dart, package:uuid/uuid.dart, package:pointycastle/export.dart, package:shared_preferences/shared_preferences.dart, hcv_identity.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_identity.dart -> dart:convert, package:crypto/crypto.dart, package:shared_preferences/shared_preferences.dart, package:uuid/uuid.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_import_router_page.dart -> dart:io, package:flutter/material.dart, hcvpack_player_page.dart, verify_page.dart, registry_verify_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_live_signals.dart -> dart:async, dart:math, package:sensors_plus/sensors_plus.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_package.dart -> dart:convert, dart:io, package:archive/archive_io.dart, package:crypto/crypto.dart, package:path/path.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_registry_service.dart -> dart:convert, dart:io
VERSIONE FUNZIONANTE  LOCALE 5/hcv_verifier.dart -> dart:convert, dart:io, dart:typed_data, package:crypto/crypto.dart, package:pointycastle/export.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcv_video_watermark.dart -> dart:io, package:path/path.dart
VERSIONE FUNZIONANTE  LOCALE 5/hcvpack_player_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:media_kit/media_kit.dart, package:media_kit_video/media_kit_video.dart, package:crypto/crypto.dart, package:archive/archive.dart, package:path_provider/path_provider.dart, package:path/path.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE  LOCALE 5/home_page.dart -> package:flutter/material.dart, package:flutter/services.dart, camera_page.dart, hcvpack_player_page.dart, hcv_import_router_page.dart, import_page.dart, identity_page.dart, text_cert_page.dart, registry_verify_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/identity_page.dart -> package:flutter/material.dart, package:shared_preferences/shared_preferences.dart
VERSIONE FUNZIONANTE  LOCALE 5/import_page.dart -> package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_import_router_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/main.dart -> package:flutter/material.dart, package:media_kit/media_kit.dart, home_page.dart
VERSIONE FUNZIONANTE  LOCALE 5/registry_verify_page.dart -> dart:convert, dart:io, package:crypto/crypto.dart, package:file_picker/file_picker.dart, package:flutter/material.dart, package:path_provider/path_provider.dart, hcv_registry_service.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE  LOCALE 5/text_cert_page.dart -> dart:convert, dart:io, package:crypto/crypto.dart, package:flutter/material.dart, package:flutter/services.dart, package:path/path.dart, package:share_plus/share_plus.dart, hcv_engine.dart, hcv_verifier.dart, hcv_registry_service.dart
VERSIONE FUNZIONANTE  LOCALE 5/verifier_page.dart -> dart:convert, dart:io, package:crypto/crypto.dart
VERSIONE FUNZIONANTE  LOCALE 5/verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE  LOCALE 5/video_player_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, package:video_player/video_player.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE  LOCALE 5/video_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 1/camera_page.dart -> dart:io, package:flutter/material.dart, package:camera/camera.dart, package:crypto/crypto.dart, package:path/path.dart, package:share_plus/share_plus.dart, hcv_engine.dart, hcv_verifier.dart, hcv_package.dart
VERSIONE FUNZIONANTE 1/camera_service.dart -> package:flutter/foundation.dart
VERSIONE FUNZIONANTE 1/hcv_engine.dart -> dart:convert, dart:io, dart:math, dart:typed_data, package:crypto/crypto.dart, package:path_provider/path_provider.dart, package:path/path.dart, package:uuid/uuid.dart, package:pointycastle/export.dart, package:shared_preferences/shared_preferences.dart
VERSIONE FUNZIONANTE 1/hcv_import_router_page.dart -> dart:io, package:flutter/material.dart, package:crypto/crypto.dart, hcvpack_player_page.dart, verify_page.dart, video_verify_page.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 1/hcv_package.dart -> package:path_provider/path_provider.dart, dart:io, dart:convert, package:path/path.dart
VERSIONE FUNZIONANTE 1/hcv_verifier.dart -> dart:convert, dart:io, dart:typed_data, package:crypto/crypto.dart, package:pointycastle/export.dart
VERSIONE FUNZIONANTE 1/hcvpack_player_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:media_kit/media_kit.dart, package:media_kit_video/media_kit_video.dart, package:crypto/crypto.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 1/home_page.dart -> package:flutter/material.dart, package:flutter/services.dart, camera_page.dart, hcvpack_player_page.dart, hcv_import_router_page.dart, import_page.dart
VERSIONE FUNZIONANTE 1/import_page.dart -> package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_import_router_page.dart
VERSIONE FUNZIONANTE 1/main.dart -> package:flutter/material.dart, package:media_kit/media_kit.dart, home_page.dart
VERSIONE FUNZIONANTE 1/text_cert_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:crypto/crypto.dart, package:path_provider/path_provider.dart, package:path/path.dart, hcv_engine.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 1/verifier_page.dart -> dart:convert, dart:io, package:crypto/crypto.dart
VERSIONE FUNZIONANTE 1/verify_page.dart -> package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 1/video_player_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, package:video_player/video_player.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 1/video_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 2/camera_page.dart -> dart:io, package:flutter/material.dart, package:camera/camera.dart, package:crypto/crypto.dart, package:path/path.dart, package:share_plus/share_plus.dart, hcv_engine.dart, hcv_verifier.dart, hcv_package.dart
VERSIONE FUNZIONANTE 2/camera_service.dart -> package:flutter/foundation.dart
VERSIONE FUNZIONANTE 2/hcv_engine.dart -> dart:convert, dart:io, dart:math, dart:typed_data, package:crypto/crypto.dart, package:path_provider/path_provider.dart, package:path/path.dart, package:uuid/uuid.dart, package:pointycastle/export.dart, package:shared_preferences/shared_preferences.dart
VERSIONE FUNZIONANTE 2/hcv_import_router_page.dart -> dart:io, package:flutter/material.dart, package:crypto/crypto.dart, hcvpack_player_page.dart, verify_page.dart, video_verify_page.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 2/hcv_package.dart -> dart:convert, dart:io, package:archive/archive_io.dart, package:crypto/crypto.dart, package:path/path.dart
VERSIONE FUNZIONANTE 2/hcv_verifier.dart -> dart:convert, dart:io, dart:typed_data, package:crypto/crypto.dart, package:pointycastle/export.dart
VERSIONE FUNZIONANTE 2/hcvpack_player_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:media_kit/media_kit.dart, package:media_kit_video/media_kit_video.dart, package:crypto/crypto.dart, package:archive/archive.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 2/home_page.dart -> package:flutter/material.dart, package:flutter/services.dart, camera_page.dart, hcvpack_player_page.dart, hcv_import_router_page.dart, import_page.dart
VERSIONE FUNZIONANTE 2/import_page.dart -> package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_import_router_page.dart
VERSIONE FUNZIONANTE 2/main.dart -> package:flutter/material.dart, package:media_kit/media_kit.dart, home_page.dart
VERSIONE FUNZIONANTE 2/text_cert_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:crypto/crypto.dart, package:path_provider/path_provider.dart, package:path/path.dart, hcv_engine.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 2/verifier_page.dart -> dart:convert, dart:io, package:crypto/crypto.dart
VERSIONE FUNZIONANTE 2/verify_page.dart -> package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 2/video_player_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, package:video_player/video_player.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 2/video_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 3/camera_page.dart -> dart:io, package:flutter/material.dart, package:camera/camera.dart, package:crypto/crypto.dart, package:path/path.dart, package:share_plus/share_plus.dart, hcv_engine.dart, hcv_verifier.dart, hcv_package.dart
VERSIONE FUNZIONANTE 3/camera_service.dart -> package:flutter/foundation.dart
VERSIONE FUNZIONANTE 3/hcv_crypto.dart -> dart:convert, dart:typed_data, package:cryptography/cryptography.dart
VERSIONE FUNZIONANTE 3/hcv_engine.dart -> dart:convert, dart:io, dart:math, dart:typed_data, package:crypto/crypto.dart, package:path_provider/path_provider.dart, package:path/path.dart, package:uuid/uuid.dart, package:pointycastle/export.dart, package:shared_preferences/shared_preferences.dart, hcv_identity.dart
VERSIONE FUNZIONANTE 3/hcv_identity.dart -> dart:convert, package:crypto/crypto.dart, package:shared_preferences/shared_preferences.dart, package:uuid/uuid.dart
VERSIONE FUNZIONANTE 3/hcv_import_router_page.dart -> dart:io, package:flutter/material.dart, package:crypto/crypto.dart, hcvpack_player_page.dart, verify_page.dart, video_verify_page.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 3/hcv_package.dart -> dart:convert, dart:io, package:archive/archive_io.dart, package:crypto/crypto.dart, package:path/path.dart
VERSIONE FUNZIONANTE 3/hcv_verifier.dart -> dart:convert, dart:io, dart:typed_data, package:crypto/crypto.dart, package:pointycastle/export.dart
VERSIONE FUNZIONANTE 3/hcvpack_player_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:media_kit/media_kit.dart, package:media_kit_video/media_kit_video.dart, package:crypto/crypto.dart, package:archive/archive.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 3/home_page.dart -> package:flutter/material.dart, package:flutter/services.dart, camera_page.dart, hcvpack_player_page.dart, hcv_import_router_page.dart, import_page.dart, identity_page.dart, text_cert_page.dart
VERSIONE FUNZIONANTE 3/identity_page.dart -> package:flutter/material.dart, package:shared_preferences/shared_preferences.dart
VERSIONE FUNZIONANTE 3/import_page.dart -> package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_import_router_page.dart
VERSIONE FUNZIONANTE 3/main.dart -> package:flutter/material.dart, package:media_kit/media_kit.dart, home_page.dart
VERSIONE FUNZIONANTE 3/text_cert_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:crypto/crypto.dart, package:path_provider/path_provider.dart, package:path/path.dart, hcv_engine.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 3/verifier_page.dart -> dart:convert, dart:io, package:crypto/crypto.dart
VERSIONE FUNZIONANTE 3/verify_page.dart -> package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 3/video_player_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, package:video_player/video_player.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE 3/video_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE/camera_page.dart -> dart:io, package:flutter/material.dart, package:camera/camera.dart, package:crypto/crypto.dart, package:path/path.dart, hcv_engine.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE/camera_service.dart -> package:flutter/foundation.dart
VERSIONE FUNZIONANTE/hcv_engine.dart -> dart:convert, dart:io, dart:math, dart:typed_data, package:crypto/crypto.dart, package:path_provider/path_provider.dart, package:path/path.dart, package:uuid/uuid.dart, package:pointycastle/export.dart, package:shared_preferences/shared_preferences.dart
VERSIONE FUNZIONANTE/hcv_verifier.dart -> dart:convert, dart:io, dart:typed_data, package:crypto/crypto.dart, package:pointycastle/export.dart
VERSIONE FUNZIONANTE/home_page.dart -> package:flutter/material.dart, camera_page.dart, text_cert_page.dart, verify_page.dart, video_verify_page.dart, video_player_verify_page.dart
VERSIONE FUNZIONANTE/main.dart -> package:flutter/material.dart, home_page.dart
VERSIONE FUNZIONANTE/text_cert_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:crypto/crypto.dart, package:path_provider/path_provider.dart, package:path/path.dart, hcv_engine.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE/verifier_page.dart -> dart:convert, dart:io, package:crypto/crypto.dart
VERSIONE FUNZIONANTE/verify_page.dart -> package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE/video_player_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, package:video_player/video_player.dart, hcv_verifier.dart
VERSIONE FUNZIONANTE/video_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, hcv_verifier.dart
ai_trainer_server/server.js -> dotenv/config
android/app/src/main/kotlin/com/example/hcv_app/hcv_keystore_signer.dart -> package:flutter/services.dart
hcv_modifiche_complete/hcv_modifiche/camera_page.dart -> dart:io, package:flutter/material.dart, package:camera/camera.dart, package:crypto/crypto.dart, package:path/path.dart, package:share_plus/share_plus.dart, hcv_engine.dart, hcv_verifier.dart, hcv_package.dart
hcv_modifiche_complete/hcv_modifiche/hcv_import_router_page.dart -> package:flutter/material.dart, hcv_import_service.dart, hcvpack_player_page.dart, verify_page.dart, video_verify_page.dart
hcv_modifiche_complete/hcv_modifiche/hcvpack_player_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:media_kit/media_kit.dart, package:media_kit_video/media_kit_video.dart, package:crypto/crypto.dart, hcv_verifier.dart
hcv_modifiche_complete/hcv_modifiche/home_page.dart -> package:flutter/material.dart, camera_page.dart, text_cert_page.dart, verify_page.dart, video_verify_page.dart, video_player_verify_page.dart, hcvpack_player_page.dart
hcv_modifiche_complete/hcv_modifiche/verify_page.dart -> package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_verifier.dart
hcv_modifiche_complete/hcv_modifiche/video_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, hcv_verifier.dart
lib/account_page.dart -> dart:async, package:flutter/material.dart, hcv_auth_service.dart, hcv_identity.dart, identity_page.dart, legal_info_page.dart, sigillum_localization.dart, sigillum_theme.dart
lib/camera_page.dart -> dart:async, dart:convert, dart:io, package:flutter/material.dart, package:flutter/services.dart, package:camera/camera.dart, package:crypto/crypto.dart, package:path/path.dart, package:share_plus/share_plus.dart, hcv_engine.dart, hcv_verifier.dart, hcv_package.dart, hcv_registry_service.dart, hcv_live_signals.dart, hcv_live_screen_probe.dart, hcv_trust_analyzer.dart, hcv_location_video_watermark.dart, package:path_provider/path_provider.dart, hcv_social_fingerprint.dart, hcv_location_image_watermark.dart, hcv_capture_location.dart, hcv_screen_replay_analyzer.dart, hcv_temporal_capture_probe.dart, hcv_temporal_frequency_probe.dart, hcv_ml_screen_replay_classifier.dart, hcv_ml_v3_photo_residual.dart, hcv_display_risk_fusion.dart, hcv_multi_evidence_display_policy.dart, hcv_photo_framing_evidence.dart, hcv_photo_visual_framing.dart, hcv_photo_semantic_framing_inference.dart, hcv_scene_context_evidence.dart, hcv_capture_timestamp.dart, sigillum_localization.dart, camera_ui_extended_copy.dart, video_transcription_service.dart, sigillum_quick_guide_page.dart, hcv_secure_media_vault.dart, secure_originals_page.dart, verified_originals_publish_service.dart
lib/camera_service.dart -> package:flutter/foundation.dart
lib/camera_ui_extended_copy.dart -> camera_ui_copy.dart
lib/commercial_account_service.dart -> dart:async, dart:convert, dart:io, package:flutter/services.dart, hcv_auth_service.dart, hcv_identity.dart, hcv_keystore_signer.dart, hcv_secure_store.dart
lib/commercial_billing_service.dart -> dart:async, package:flutter/foundation.dart, package:flutter/services.dart, package:in_app_purchase/in_app_purchase.dart, package:in_app_purchase_storekit/store_kit_2_wrappers.dart, commercial_account_service.dart
lib/commercial_gate.dart -> dart:async, dart:io, package:flutter/material.dart, package:flutter/services.dart, package:in_app_purchase/in_app_purchase.dart, package:shared_preferences/shared_preferences.dart, package:url_launcher/url_launcher.dart, commercial_account_service.dart, commercial_billing_service.dart, hcv_identity.dart, hcv_import_router_page.dart, import_page.dart, verified_originals_page.dart, legal_info_page.dart, sigillum_localization.dart, recent_account_service.dart, sigillum_quick_guide_page.dart, sigillum_theme.dart, text_social_verify_page.dart, user_home_page.dart
lib/commercial_profile_page.dart -> package:flutter/material.dart, package:flutter/services.dart, package:url_launcher/url_launcher.dart, commercial_account_service.dart, hcv_auth_service.dart, hcv_identity.dart, hcv_secure_media_vault.dart, legal_info_page.dart, sigillum_localization.dart, sigillum_theme.dart
lib/hcv_active_display_classifier.dart -> dart:math
lib/hcv_ai_training_service.dart -> dart:convert, dart:io, package:path/path.dart, package:shared_preferences/shared_preferences.dart
lib/hcv_audio_fingerprint.dart -> dart:io, dart:math, package:crypto/crypto.dart, package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart, package:ffmpeg_kit_flutter_new/return_code.dart, package:path/path.dart, package:path_provider/path_provider.dart
lib/hcv_auth_service.dart -> dart:async, dart:convert, dart:io, hcv_identity.dart, hcv_keystore_signer.dart, hcv_secure_store.dart
lib/hcv_capture_location.dart -> package:geolocator/geolocator.dart
lib/hcv_capture_provenance.dart -> dart:io, package:path/path.dart, hcv_identity.dart, hcv_provenance_chain.dart
lib/hcv_context_free_display_policy.dart -> dart:math, hcv_display_risk_fusion.dart
lib/hcv_crypto.dart -> dart:convert, package:cryptography/cryptography.dart
lib/hcv_display_final_policy.dart -> dart:math, hcv_display_risk_fusion.dart, hcv_scene_context_evidence.dart
lib/hcv_display_lattice_discriminator.dart -> dart:math, package:image/image.dart
lib/hcv_display_risk_fusion.dart -> dart:math
lib/hcv_engine.dart -> dart:convert, dart:io, package:crypto/crypto.dart, package:package_info_plus/package_info_plus.dart, package:path_provider/path_provider.dart, package:path/path.dart, package:uuid/uuid.dart, hcv_capture_provenance.dart, hcv_identity.dart, hcv_keystore_signer.dart, hcv_software_attestation.dart
lib/hcv_file_provenance_gate_page.dart -> dart:convert, dart:io, package:flutter/material.dart, hcv_registry_provenance.dart, hcv_verifier.dart, sigillum_theme.dart, verify_page.dart
lib/hcv_id_lookup_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:path_provider/path_provider.dart, hcv_registry_service.dart, hcv_verifier.dart, sigillum_theme.dart
lib/hcv_identity.dart -> dart:convert, dart:io, package:crypto/crypto.dart, package:shared_preferences/shared_preferences.dart, package:uuid/uuid.dart, hcv_keystore_signer.dart
lib/hcv_image_watermark.dart -> dart:io, package:image/image.dart, package:path/path.dart, hcv_capture_timestamp.dart
lib/hcv_import_router_page.dart -> dart:io, package:flutter/material.dart, hcv_file_provenance_gate_page.dart, hcvpack_provenance_gate_page.dart, quick_hcv_media_gate_page.dart, registry_verify_page.dart, sigillum_localization.dart, verification_ui_copy.dart
lib/hcv_keystore_signer.dart -> dart:convert, dart:io, package:crypto/crypto.dart, package:flutter/services.dart
lib/hcv_live_screen_probe.dart -> dart:async, dart:math, package:camera/camera.dart, hcv_active_display_classifier.dart, hcv_display_risk_fusion.dart, hcv_projective_motion_model.dart, hcv_scene_geometry_classifier.dart, hcv_scene_decision_fusion.dart, hcv_scene_context_evidence.dart, hcv_temporal_capture_probe.dart
lib/hcv_live_signals.dart -> dart:async, dart:math, package:sensors_plus/sensors_plus.dart
lib/hcv_location_image_watermark.dart -> dart:io, package:image/image.dart, package:path/path.dart, hcv_capture_location.dart, hcv_capture_timestamp.dart
lib/hcv_location_video_watermark.dart -> dart:io, package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart, package:ffmpeg_kit_flutter_new/return_code.dart, package:path/path.dart, package:path_provider/path_provider.dart, hcv_capture_location.dart, hcv_capture_timestamp.dart
lib/hcv_logo_badge.dart -> package:flutter/material.dart
lib/hcv_media_id_ocr.dart -> dart:io, dart:math, package:flutter/services.dart, package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart, package:image/image.dart, package:path/path.dart, package:path_provider/path_provider.dart
lib/hcv_ml_model_store.dart -> dart:convert, dart:io, package:archive/archive_io.dart, package:crypto/crypto.dart, package:flutter/services.dart, package:path/path.dart, package:path_provider/path_provider.dart
lib/hcv_ml_screen_replay_classifier.dart -> dart:convert, dart:io, dart:math, package:flutter/services.dart, package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart, package:ffmpeg_kit_flutter_new/return_code.dart, package:crypto/crypto.dart, package:image/image.dart, package:path/path.dart, package:path_provider/path_provider.dart, package:tflite_flutter/tflite_flutter.dart, hcv_ml_model_store.dart, hcv_video_photo_spatial_evidence.dart, sigillum_edition.dart
lib/hcv_ml_v3_photo_residual.dart -> dart:io, package:crypto/crypto.dart, package:flutter/services.dart, package:image/image.dart, package:tflite_flutter/tflite_flutter.dart
lib/hcv_multi_evidence_display_policy.dart -> dart:math, hcv_display_risk_fusion.dart, hcv_photo_framing_evidence.dart
lib/hcv_package.dart -> dart:convert, dart:io, package:archive/archive_io.dart, package:crypto/crypto.dart, package:path/path.dart, package:path_provider/path_provider.dart
lib/hcv_photo_detail_compare.dart -> dart:io, dart:math, dart:typed_data, package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart, package:ffmpeg_kit_flutter_new/return_code.dart, package:path/path.dart, package:path_provider/path_provider.dart
lib/hcv_photo_semantic_framing_inference.dart -> dart:io, package:crypto/crypto.dart, package:flutter/services.dart, package:image/image.dart, package:tflite_flutter/tflite_flutter.dart, hcv_photo_semantic_framing_contract.dart
lib/hcv_photo_semantic_framing_runner.dart -> dart:io, package:flutter/services.dart, package:crypto/crypto.dart, package:image/image.dart, package:tflite_flutter/tflite_flutter.dart, hcv_photo_semantic_framing_contract.dart
lib/hcv_photo_visual_framing.dart -> dart:io, dart:math, package:image/image.dart
lib/hcv_planar_motion_model.dart -> dart:math
lib/hcv_projective_motion_model.dart -> dart:math
lib/hcv_provenance_chain.dart -> dart:async, dart:convert, dart:io, dart:math, dart:typed_data, package:crypto/crypto.dart, package:pointycastle/export.dart, hcv_keystore_signer.dart
lib/hcv_reference_visual_fingerprint_v3.dart -> dart:convert, dart:io, dart:math, dart:typed_data, package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart, package:ffmpeg_kit_flutter_new/return_code.dart, package:path/path.dart, package:path_provider/path_provider.dart
lib/hcv_registry_provenance.dart -> dart:async, dart:convert, dart:io, package:crypto/crypto.dart
lib/hcv_registry_service.dart -> dart:async, dart:convert, dart:io, package:shared_preferences/shared_preferences.dart, hcv_keystore_signer.dart, hcv_secure_store.dart
lib/hcv_scene_decision_fusion.dart -> dart:math, hcv_active_display_classifier.dart, hcv_scene_geometry_classifier.dart
lib/hcv_scene_geometry_classifier.dart -> dart:math
lib/hcv_screen_replay_analyzer.dart -> dart:io, dart:math, package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart, package:ffmpeg_kit_flutter_new/return_code.dart, package:image/image.dart, package:path/path.dart, package:path_provider/path_provider.dart, hcv_display_lattice_discriminator.dart
lib/hcv_secure_media_vault.dart -> dart:async, dart:convert, dart:io, dart:math, dart:typed_data, package:crypto/crypto.dart, package:cryptography/cryptography.dart, package:path/path.dart, package:path_provider/path_provider.dart, hcv_identity.dart, hcv_secure_store.dart
lib/hcv_secure_preview_service.dart -> dart:io, package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart, package:ffmpeg_kit_flutter_new/return_code.dart, package:image/image.dart, package:path/path.dart, package:path_provider/path_provider.dart, hcv_secure_media_vault.dart
lib/hcv_secure_store.dart -> dart:io, package:flutter/services.dart
lib/hcv_social_fingerprint.dart -> dart:io, dart:math, package:crypto/crypto.dart, package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart, package:ffmpeg_kit_flutter_new/return_code.dart, package:flutter/services.dart, package:image/image.dart, package:path/path.dart, package:path_provider/path_provider.dart, hcv_audio_fingerprint.dart, hcv_spatial_fingerprint_v2.dart
lib/hcv_spatial_fingerprint_v2.dart -> dart:math, package:image/image.dart
lib/hcv_temporal_capture_probe.dart -> dart:io, package:camera/camera.dart, hcv_ml_screen_replay_classifier.dart, hcv_screen_replay_analyzer.dart
lib/hcv_temporal_frequency_probe.dart -> dart:math, package:flutter/services.dart
lib/hcv_text_integrity.dart -> dart:convert, dart:io, package:archive/archive_io.dart, package:crypto/crypto.dart, package:path/path.dart, package:path_provider/path_provider.dart
lib/hcv_verifier.dart -> dart:convert, dart:io, dart:typed_data, package:crypto/crypto.dart, package:pointycastle/export.dart, hcv_provenance_chain.dart, hcv_software_attestation.dart
lib/hcv_video_watermark.dart -> dart:io, package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart, package:ffmpeg_kit_flutter_new/return_code.dart, package:path/path.dart, package:path_provider/path_provider.dart, hcv_capture_timestamp.dart
lib/hcvpack_player_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, package:archive/archive.dart, package:path_provider/path_provider.dart, package:path/path.dart, hcv_verifier.dart, sigillum_localization.dart, verification_ui_copy.dart
lib/hcvpack_provenance_gate_page.dart -> dart:convert, dart:io, package:archive/archive.dart, package:crypto/crypto.dart, package:flutter/material.dart, package:path/path.dart, package:path_provider/path_provider.dart, hcv_registry_provenance.dart, hcv_verifier.dart, hcvpack_player_page.dart, sigillum_theme.dart
lib/home_page.dart -> package:flutter/material.dart, package:flutter/services.dart, camera_page.dart, hcv_import_router_page.dart, hcvpack_player_page.dart, identity_page.dart, import_page.dart, registry_verify_page.dart, verified_originals_page.dart, screen_replay_calibration_page.dart, screen_replay_diagnostics_page.dart, text_cert_page.dart, sigillum_localization.dart, lab_ui_copy.dart
lib/identity_page.dart -> dart:convert, package:flutter/material.dart, package:url_launcher/url_launcher.dart, hcv_identity.dart, hcv_registry_service.dart, sigillum_localization.dart
lib/import_page.dart -> dart:io, package:flutter/material.dart, package:flutter/services.dart, package:file_picker/file_picker.dart, package:image_picker/image_picker.dart, hcv_id_lookup_page.dart, hcv_import_router_page.dart, sigillum_localization.dart, sigillum_theme.dart, text_social_verify_page.dart, verification_ui_copy.dart
lib/legal_info_page.dart -> package:flutter/material.dart, package:url_launcher/url_launcher.dart, sigillum_localization.dart, sigillum_theme.dart
lib/main X ANDROID.dart -> package:flutter/material.dart, package:media_kit/media_kit.dart, home_page.dart
lib/main.dart -> package:flutter/material.dart, package:media_kit/media_kit.dart, commercial_gate.dart, home_page.dart, hcv_secure_media_vault.dart, sigillum_edition.dart, sigillum_theme.dart
lib/manual_reference_compare_page.dart -> dart:io, dart:math, package:flutter/material.dart, package:video_player/video_player.dart, commercial_account_service.dart, commercial_gate.dart, registry_verify_copy.dart, sigillum_theme.dart, verified_originals_publish_service.dart, verified_originals_reference.dart, verified_reference_viewer_page.dart
lib/quick_hcv_media_gate_page.dart -> dart:io, package:flutter/material.dart, package:flutter/services.dart, package:path/path.dart, hcv_media_id_ocr.dart, registry_verify_page.dart, sigillum_theme.dart, verification_ui_copy.dart
lib/recent_account_service.dart -> package:shared_preferences/shared_preferences.dart
lib/registry_verify_page.dart -> dart:async, dart:convert, dart:io, dart:math, package:crypto/crypto.dart, package:file_picker/file_picker.dart, package:flutter/material.dart, package:flutter/services.dart, package:path_provider/path_provider.dart, hcv_registry_service.dart, hcv_verifier.dart, package:path/path.dart, package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart, package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart, package:ffmpeg_kit_flutter_new/return_code.dart, hcv_social_fingerprint.dart, hcv_spatial_fingerprint_v2.dart, hcv_audio_fingerprint.dart, hcv_reference_visual_fingerprint_v3.dart, verified_originals_publish_service.dart, hcv_media_id_ocr.dart, manual_reference_compare_page.dart, sigillum_localization.dart, sigillum_theme.dart, verification_ui_copy.dart, registry_verify_copy.dart
lib/screen_replay_calibration_page.dart -> dart:convert, dart:io, package:archive/archive_io.dart, package:camera/camera.dart, package:crypto/crypto.dart, package:file_picker/file_picker.dart, package:flutter/material.dart, package:flutter/services.dart, package:path/path.dart, package:path_provider/path_provider.dart, package:share_plus/share_plus.dart, hcv_ai_training_service.dart, hcv_live_screen_probe.dart, hcv_ml_model_store.dart, hcv_ml_screen_replay_classifier.dart, lab_ui_copy.dart
lib/screen_replay_diagnostics_page.dart -> dart:convert, dart:io, dart:math, package:file_picker/file_picker.dart, package:flutter/material.dart, package:flutter/services.dart, package:path_provider/path_provider.dart, package:share_plus/share_plus.dart, hcv_screen_replay_analyzer.dart, hcv_ml_screen_replay_classifier.dart, lab_ui_copy.dart
lib/secure_originals_page.dart -> dart:async, dart:io, package:flutter/material.dart, package:flutter/services.dart, package:share_plus/share_plus.dart, package:video_player/video_player.dart, hcv_registry_service.dart, hcv_secure_media_vault.dart, hcv_secure_preview_service.dart, registry_verify_page.dart, sigillum_localization.dart, verified_originals_publish_service.dart, verified_reference_viewer_page.dart
lib/sigillum_localization.dart -> dart:ui
lib/sigillum_quick_guide_page.dart -> package:flutter/material.dart, sigillum_theme.dart
lib/sigillum_theme.dart -> package:flutter/material.dart
lib/test_watermark.dart -> dart:io, package:ffmpeg_kit_flutter_new/ffmpeg_kit.dart, package:path/path.dart
lib/text_cert_page.dart -> dart:convert, dart:io, package:crypto/crypto.dart, package:flutter/material.dart, package:flutter/services.dart, package:path/path.dart, package:share_plus/share_plus.dart, hcv_engine.dart, hcv_verifier.dart, hcv_registry_service.dart, hcv_text_integrity.dart, text_social_verify_page.dart, sigillum_localization.dart
lib/text_social_verify_page.dart -> dart:convert, dart:io, package:file_picker/file_picker.dart, package:flutter/material.dart, package:flutter/services.dart, package:path/path.dart, package:path_provider/path_provider.dart, hcv_registry_service.dart, hcv_text_integrity.dart, hcv_verifier.dart, sigillum_theme.dart
lib/user_home_page.dart -> package:flutter/material.dart, package:shared_preferences/shared_preferences.dart, camera_page.dart, commercial_account_service.dart, hcv_registry_service.dart, commercial_profile_page.dart, import_page.dart, verified_originals_page.dart, secure_originals_page.dart, legal_info_page.dart, sigillum_localization.dart, sigillum_theme.dart, sigillum_quick_guide_page.dart, text_cert_page.dart
lib/verified_originals_page.dart -> dart:convert, dart:io, package:flutter/material.dart, commercial_account_service.dart, hcv_registry_service.dart, registry_verify_page.dart, sigillum_localization.dart, verified_originals_publish_service.dart, verified_originals_reference.dart, verified_reference_viewer_page.dart
lib/verified_originals_publish_service.dart -> dart:async, dart:convert, dart:io, package:crypto/crypto.dart, package:path/path.dart, package:path_provider/path_provider.dart, hcv_registry_service.dart, hcv_keystore_signer.dart, hcv_secure_media_vault.dart, hcv_secure_store.dart, verified_originals_reference.dart
lib/verified_reference_viewer_page.dart -> dart:async, dart:io, package:flutter/material.dart, package:video_player/video_player.dart
lib/verifier_page.dart -> dart:convert, dart:io, package:crypto/crypto.dart
lib/verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, hcv_verifier.dart, sigillum_localization.dart
lib/video_player_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, package:video_player/video_player.dart, hcv_verifier.dart, hcv_logo_badge.dart, sigillum_localization.dart
lib/video_transcription_service.dart -> dart:io, package:flutter/services.dart, package:path/path.dart, package:path_provider/path_provider.dart
lib/video_verify_page.dart -> dart:convert, dart:io, package:flutter/material.dart, package:file_picker/file_picker.dart, package:crypto/crypto.dart, hcv_verifier.dart, sigillum_localization.dart
test/account_page_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, commercial_profile_page.dart
test/account_success_feedback_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, dart:async
test/active_probe_v4_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/active_probe_zoom_wait_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/apple_current_entitlement_reconciliation_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/apple_foreign_entitlement_purchase_preflight_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/archive15_display_risk_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/archive17_display_risk_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/archive18_display_risk_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/archive19_flash_response_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_active_display_classifier.dart
test/archive20_scene_policy_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_active_display_classifier.dart, package:sigillum_iphone/hcv_scene_decision_fusion.dart, package:sigillum_iphone/hcv_scene_geometry_classifier.dart
test/archive42_reality_active_probe_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_active_display_classifier.dart
test/build109_low_modulation_hfr_recovery_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_temporal_frequency_probe.dart
test/build109_ml_fullframe_recovery_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/build111_photo_monitor_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/build112_photo_optical_corroboration_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/build112_social_fingerprint_failclosed_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/registry_verify_page.dart
test/build113_audio_fingerprint_test.dart -> dart:io, dart:math, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_audio_fingerprint.dart, package:sigillum_iphone/registry_verify_page.dart
test/build113_copy_localization_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/sigillum_localization.dart, package:sigillum_iphone/verification_ui_copy.dart, package:sigillum_iphone/registry_verify_copy.dart, package:sigillum_iphone/lab_ui_copy.dart
test/build115_reflection_semantic_resolution_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/build116_bmw_display_hfr_mixedscene_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart, package:sigillum_iphone/hcv_temporal_frequency_probe.dart
test/build117_scene_context_architecture_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_final_policy.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart, package:sigillum_iphone/hcv_scene_context_evidence.dart
test/build118_photo_preview_highres_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build119_photo_preview_rotation_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build120_passive_scene_context_activation_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_final_policy.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart, package:sigillum_iphone/hcv_scene_context_evidence.dart
test/build121_unified_photo_scene_context_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/build122_corpus_wide_recovery_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_final_policy.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart, package:sigillum_iphone/hcv_scene_context_evidence.dart
test/build123_context_free_display_policy_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_context_free_display_policy.dart
test/build124_multi_evidence_display_policy_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_multi_evidence_display_policy.dart
test/build125_fov_comparability_guard_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_multi_evidence_display_policy.dart
test/build125_zoom_coherent_hfr_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build126_video_fov_persistence_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_multi_evidence_display_policy.dart, package:sigillum_iphone/hcv_temporal_frequency_probe.dart
test/build127_archive90_video_lattice_regression_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_multi_evidence_display_policy.dart
test/build127_ml_hard_negative_training_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build127_physical_texture_lattice_guard_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:image/image.dart, package:sigillum_iphone/hcv_display_lattice_discriminator.dart, package:sigillum_iphone/hcv_multi_evidence_display_policy.dart
test/build127_v3_photo_residual_28case_gate_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_ml_v3_photo_residual.dart
test/build127_v3_photo_residual_policy_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_ml_v3_photo_residual.dart, package:sigillum_iphone/hcv_multi_evidence_display_policy.dart
test/build128_derivative_integrity_spatial_v2_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:image/image.dart, package:sigillum_iphone/hcv_spatial_fingerprint_v2.dart, package:sigillum_iphone/registry_verify_copy.dart
test/build128_original_hard_binding_fail_closed_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build128_photo_video_preview_fov_parity_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build133_live_reference_and_recovery_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build133_release_hardening_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build136_field_regression_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, registry_verify_page.dart
test/build137_text_scene_ux_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build139_r2_primary_reference_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build142_r2_manual_compare_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build143_authorized_subtitle_derivation_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build144_prelaunch_hardening_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build145_social_verification_recovery_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build146_text_verification_entry_test.dart -> dart:io, package:flutter_test/flutter_test.dart, text_social_verify_page.dart
test/build147_gps_photo_integrity_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build148_photo_microtamper_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build149_authorized_derivative_scene_result_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build149_product_communication_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build65_display_recall_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/camera_page.dart
test/build66_planar_multiframe_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/build67_reality_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/build69_capture_fusion_integration_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/camera_page.dart
test/build71_video_semantic_persistence_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/camera_page.dart
test/build72_verification_scene_copy_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/build72_video_reality_and_container_regression_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/camera_page.dart
test/build73_video_screen_persistence_v2_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/camera_page.dart
test/build74_fusion_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/camera_page.dart
test/build96_login_quickverify_regression_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/c8ff_regression_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/camera_focus_recovery_after_native_probe_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/camera_physical_scene_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/camera_ready_video_evidence_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/capture_location_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/commercial_api_transport_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/commercial_billing_fresh_server_status_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/commercial_billing_server_verification_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/commercial_registration_timeout_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/commercial_ux_kyc_identity_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/creator_entitlement_revalidation_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/creator_weekly_subscription_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/current_device_monitor_recall_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/device_revocation_ui_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/display_risk_policy_v4_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/display_signature_matrix_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/dual_display_reality_evidence_v1_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/fast_uncertified_media_precheck_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/final_localization_hardening_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/final_video_ui_paywall_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/foreign_storekit_stale_transaction_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/free_photo_reference_verification_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/frequency_probe_session_safety_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:camera/camera.dart
test/geometry_not_absolute_proof_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/hcv_active_display_classifier_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_active_display_classifier.dart
test/hcv_active_display_fusion_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/hcv_capture_provenance_test.dart -> dart:convert, dart:io, package:crypto/crypto.dart, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_capture_provenance.dart, package:sigillum_iphone/hcv_provenance_chain.dart
test/hcv_capture_provenance_verifier_test.dart -> dart:convert, dart:io, package:crypto/crypto.dart, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_provenance_chain.dart, package:sigillum_iphone/hcv_verifier.dart
test/hcv_capture_timestamp_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_capture_timestamp.dart
test/hcv_display_risk_conflict_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/hcv_display_risk_fusion_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/hcv_engine_capture_provenance_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, hcv_capture_provenance.dart
test/hcv_id_format_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_engine.dart, package:sigillum_iphone/hcv_registry_service.dart
test/hcv_id_lookup_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, hcv_id_lookup_page.dart
test/hcv_media_id_ocr_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_media_id_ocr.dart
test/hcv_planar_motion_model_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_planar_motion_model.dart
test/hcv_projective_motion_model_test.dart -> dart:math, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_projective_motion_model.dart
test/hcv_provenance_chain_test.dart -> dart:convert, dart:io, package:crypto/crypto.dart, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_provenance_chain.dart
test/hcv_registry_provenance_gate_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, hcvpack_provenance_gate_page.dart, hcv_file_provenance_gate_page.dart, hcvpack_player_page.dart, verify_page.dart
test/hcv_scene_decision_fusion_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_active_display_classifier.dart, package:sigillum_iphone/hcv_scene_decision_fusion.dart, package:sigillum_iphone/hcv_scene_geometry_classifier.dart
test/hcv_scene_geometry_classifier_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_scene_geometry_classifier.dart
test/hcv_software_attestation_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, hcv_software_attestation.dart, package:package_info_plus/package_info_plus.dart
test/hcv_software_attestation_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_software_attestation.dart
test/hcv_software_attestation_verifier_test.dart -> dart:convert, dart:io, package:crypto/crypto.dart, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_software_attestation.dart, package:sigillum_iphone/hcv_verifier.dart
test/hcv_text_integrity_test.dart -> dart:convert, dart:io, package:archive/archive.dart, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_text_integrity.dart
test/hcv_trust_analyzer_standard_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_trust_analyzer.dart
test/hcvpack_integrity_release_gate_test.dart -> dart:convert, dart:io, package:archive/archive.dart, package:crypto/crypto.dart, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_verifier.dart
test/hfr_coherent_display_periodicity_gate_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_temporal_frequency_probe.dart
test/hfr_coherent_display_periodicity_integration_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/hfr_v31_advanced_probe_contract_test.dart -> dart:io, dart:math, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_temporal_frequency_probe.dart
test/hfr_v32_harmonic_reality_physics_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart, package:sigillum_iphone/hcv_temporal_frequency_probe.dart
test/hfr_v3_fullframe_mixed_scene_test.dart -> dart:math, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart, package:sigillum_iphone/hcv_temporal_frequency_probe.dart
test/ios_document_open_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, hcv_media_id_ocr.dart
test/ios_photo_picker_lifecycle_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/ios_photo_picker_limited_access_fallback_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/ios_share_handoff_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/ios_video_watermark_archive42_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/kyc_recovery_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/live_probe_geometry_fields_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/media_specific_verification_picker_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:image_picker/image_picker.dart
test/messenger_mlkit_image_preflight_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/mixed_scene_monitor_regression_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/ml_calibration_corpus_v1_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/monitor_certificate_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/camera_page.dart
test/monitor_corroboration_policy_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_active_display_classifier.dart, package:sigillum_iphone/hcv_scene_decision_fusion.dart, package:sigillum_iphone/hcv_scene_geometry_classifier.dart
test/native_storefront_price_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/native_temporal_frequency_focus_handoff_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/native_temporal_frequency_v2_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_temporal_frequency_probe.dart
test/native_temporal_frequency_v2_crash_hotfix_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/native_temporal_frequency_v2_hfr_range_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/no_capture_submode_claims_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/no_strong_geometry_only_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_active_display_classifier.dart, package:sigillum_iphone/hcv_scene_decision_fusion.dart, package:sigillum_iphone/hcv_scene_geometry_classifier.dart
test/official_reference_v3_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, hcv_reference_visual_fingerprint_v3.dart, verified_originals_publish_service.dart
test/paywall_native_storefront_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/phase_c_48_case_promotion_matrix_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/phase_c_ml_geometry_persistence_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/photo_detail_compare_v4_test.dart -> dart:typed_data, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_photo_detail_compare.dart
test/photo_display_risk_policy_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/camera_page.dart
test/photo_framing_embedded_context_guard_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_photo_framing_evidence.dart, package:sigillum_iphone/hcv_multi_evidence_display_policy.dart
test/photo_hfr_partial_conflict_guard_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_multi_evidence_display_policy.dart
test/photo_ml_first_threshold_080_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/photo_ocr_registry_recovery_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_media_id_ocr.dart
test/photo_pre_capture_only_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/photo_quick_negative_latency_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/photo_semantic_capture_isolation_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/photo_semantic_framing_contract_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_photo_semantic_framing_contract.dart
test/photo_semantic_framing_tflite_asset_test.dart -> package:crypto/crypto.dart, package:flutter/services.dart, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_photo_semantic_framing_inference.dart
test/photo_semantic_opencv_preprocessing_parity_test.dart -> package:flutter_test/flutter_test.dart, package:image/image.dart
test/photo_temporal_fast_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/photo_temporal_four_frame_sampling_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/photo_temporal_v2_c8ff_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/camera_page.dart
test/photo_video_equivalent_method_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/photo_visual_framing_diagnostic_test.dart -> package:flutter_test/flutter_test.dart, package:image/image.dart, package:sigillum_iphone/hcv_photo_visual_framing.dart
test/physical_probe_user_instruction_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/physical_scene_claims_photo_video_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/physical_scene_decision_schema_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_scene_decision_fusion.dart
test/physical_scene_evidence_schema_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_scene_geometry_classifier.dart
test/planarity_safety_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_active_display_classifier.dart, package:sigillum_iphone/hcv_scene_decision_fusion.dart, package:sigillum_iphone/hcv_scene_geometry_classifier.dart
test/prelaunch_initial_scene_ui_paywall_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/prelaunch_legal_localization_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/prelaunch_product_refinement_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/prelaunch_rc2_regression_20260825_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/prelaunch_ui_camera_refinement_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/prelaunch_usability_subtitle_account_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/prelaunch_verification_registry_regression_20260824_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/prelaunch_visual_caption_refinement_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/probe_duration_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/profile_language_sync_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/public_home_unpaid_restore_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/quick_hcv_media_gate_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, hcv_media_id_ocr.dart
test/rc2_installed_runtime_regression_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/rc2_photo_integrity_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/rc2_real_world_decision_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_active_display_classifier.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart, package:sigillum_iphone/hcv_scene_decision_fusion.dart, package:sigillum_iphone/hcv_scene_geometry_classifier.dart
test/rc2_verification_scene_priority_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/reality_override_threshold_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_scene_geometry_classifier.dart
test/reality_temporal_false_positive_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/reference_visual_fingerprint_v3_test.dart -> dart:convert, dart:typed_data, package:crypto/crypto.dart, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_reference_visual_fingerprint_v3.dart
test/reflective_planar_ml_guard_regression_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/registry_display_risk_claims_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/registry_verify_page.dart
test/registry_first_capture_race_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/registry_local_republish_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/registry_subscription_expiry_retry_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/registry_transient_retry_regression_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/registry_verify_hcv_id16_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/save_original_reference_first_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/scene_class_values_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_scene_geometry_classifier.dart
test/scene_decision_values_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_scene_decision_fusion.dart
test/scene_geometry_thresholds_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_scene_geometry_classifier.dart
test/server_creator_id_sync_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/share_extension_localization_and_reference_copy_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/shared_media_cold_start_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/storefront_price_fail_closed_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/storefront_price_stability_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/storefront_session_freshness_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/storekit_cancel_retry_terminal_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/storekit_localized_price_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/storekit_transaction_lifecycle_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/storekit_user_safe_error_copy_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/subtitle_tail_coverage_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/temporal_frequency_probe_contract_test.dart -> dart:math, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_temporal_frequency_probe.dart
test/testflight_ml_release_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/text_keyboard_registry_photo_arm_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/text_social_workflow_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/v3_hard_negative_172a_gate_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_ml_v3_photo_residual.dart, package:sigillum_iphone/hcv_multi_evidence_display_policy.dart
test/verification_clarity_localization_ml_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/verification_color_semantics_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/verification_visual_consistency_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, sigillum_theme.dart
test/verified_originals_reference_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/verified_originals_reference.dart
test/verified_originals_v2_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart, hcv_secure_media_vault.dart
test/video_geometry_ml_conflict_guard_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_multi_evidence_display_policy.dart
test/video_initial_scene_policy_test.dart -> dart:io, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_multi_evidence_display_policy.dart
test/video_ml_adaptive_sampling_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/video_native_capture_writer_stability_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/video_photo_spatial_evidence_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_video_photo_spatial_evidence.dart
test/video_photo_spatial_fusion_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart, package:sigillum_iphone/hcv_video_photo_spatial_evidence.dart
test/video_transcription_full_coverage_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/weak_semantic_no_physical_resolution_test.dart -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_display_risk_fusion.dart
test/weekly_duplicate_storekit_preflight_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/weekly_entitlement_settle_regression_test.dart -> dart:io, package:flutter_test/flutter_test.dart
test/zoom_restore_contract_test.dart -> dart:io, package:flutter_test/flutter_test.dart
tool/apply_account_success_feedback.py -> package:flutter/material.dart, dart:async
tool/apply_camera_localization_finalizer_20260825.py -> camera_ui_extended_copy.dart, sigillum_localization.dart, camera_ui_copy.dart
tool/apply_commercial_profile_shell.py -> commercial_profile_page.dart, account_page.dart
tool/apply_commercial_registry_auth.py -> hcv_keystore_signer.dart, hcv_secure_store.dart
tool/apply_fast_uncertified_media_precheck_20260823.py -> sigillum_theme.dart, sigillum_localization.dart
tool/apply_file_import_and_ocr_fix.py -> hcv_media_id_ocr.dart, hcv_social_fingerprint.dart, package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_media_id_ocr.dart, dart:io
tool/apply_ios_share_handoff_fix.py -> dart:io, package:flutter_test/flutter_test.dart
tool/apply_media_specific_verification_picker_fix_20260822.py -> package:image_picker/image_picker.dart, sigillum_theme.dart, package:file_picker/file_picker.dart
tool/apply_mixed_scene_monitor_fix.py -> package:flutter_test/flutter_test.dart, package:sigillum_iphone/hcv_planar_motion_model.dart, dart:io, package:sigillum_iphone/hcv_display_risk_fusion.dart
tool/apply_prelaunch_account_help_refinement_20260818.py -> recent_account_service.dart, legal_info_page.dart, sigillum_quick_guide_page.dart, sigillum_theme.dart
tool/apply_prelaunch_camera_files_subtitle_ui_fix_20260818.py -> sigillum_quick_guide_page.dart, video_transcription_service.dart
tool/apply_prelaunch_legal_localization_20260818.py -> package:in_app_purchase/in_app_purchase.dart, package:shared_preferences/shared_preferences.dart, sigillum_localization.dart, legal_info_page.dart
tool/apply_prelaunch_product_refinement_20260817.py -> package:flutter/material.dart, package:flutter/services.dart, dart:io, text_social_verify_page.dart, text_cert_page.dart, sigillum_theme.dart, hcv_verifier.dart, video_transcription_service.dart, sigillum_localization.dart, package:flutter_test/flutter_test.dart
tool/apply_prelaunch_product_refinement_contract_fix.py -> dart:io, text_social_verify_page.dart, text_cert_page.dart
tool/apply_prelaunch_user_language_help_refinement_20260818.py -> package:flutter/material.dart, sigillum_theme.dart
tool/apply_prelaunch_ux_kyc_identity_fix.py -> package:flutter/material.dart, package:flutter/services.dart
tool/apply_prelaunch_visual_caption_refinement_20260818.py -> package:file_picker/file_picker.dart, package:flutter/material.dart, hcv_import_router_page.dart, sigillum_localization.dart, sigillum_theme.dart, text_social_verify_page.dart, hcv_verifier.dart, dart:io, package:flutter_test/flutter_test.dart
tool/apply_rc2_definitive_build_finalizer_legacy_20260825.py -> hcv_media_id_ocr.dart
tool/apply_rc2_ios_original_photo_picker_finalizer_20260825.py -> dart:io, package:flutter/services.dart, package:flutter/material.dart
tool/apply_rc2_native_storefront_price_finalizer_20260826.py -> package:flutter/services.dart, package:flutter/foundation.dart
tool/apply_rc2_photo_integrity_finalizer_20260825.py -> dart:io, package:flutter/services.dart, package:flutter/material.dart
tool/apply_rc2_photo_integrity_wrapper_20260825.py -> package:path_provider/path_provider.dart
tool/apply_rc2_photo_package_import_finalizer_20260825.py -> package:path_provider/path_provider.dart, package:path/path.dart
tool/apply_rc2_photo_parallax_and_media_verify_finalizer_20260825.py -> hcv_media_id_ocr.dart, registry_verify_page.dart
tool/apply_safe_capture_location_fix.py -> hcv_video_watermark.dart, hcv_location_video_watermark.dart, hcv_image_watermark.dart, hcv_location_image_watermark.dart, hcv_capture_location.dart, dart:io, package:flutter_test/flutter_test.dart
tool/apply_server_verified_billing_gate.py -> package:shared_preferences/shared_preferences\.dart
tool/apply_storekit_localized_price_ui_fix_20260826.py -> package:in_app_purchase_storekit/in_app_purchase_storekit.dart, package:in_app_purchase/in_app_purchase.dart, package:in_app_purchase_storekit/store_kit_2_wrappers.dart, package:flutter/foundation.dart, dart:async
tool/apply_storekit_transaction_lifecycle_fix_20260821.py -> package:in_app_purchase/in_app_purchase.dart, package:flutter/foundation.dart, package:in_app_purchase_storekit/store_kit_2_wrappers.dart
tool/apply_text_social_verification.py -> hcv_registry_service.dart, sigillum_localization.dart, hcv_text_integrity.dart, text_social_verify_page.dart
tool/apply_verification_clarity_localization_ml_fix_20260824.py -> verification_ui_copy.dart, sigillum_theme.dart, sigillum_localization.dart
tool/apply_verification_language_finalizer_20260824.py -> verification_ui_copy.dart, sigillum_theme.dart
tool/run_ios_share_handoff_fix.py -> dart:io, package:flutter_test/flutter_test.dart
tool/validate_display_fusion.dart -> dart:io, package:sigillum_iphone/hcv_display_risk_fusion.dart
tool/verify_postpatch_release_20260825.py -> camera_ui_extended_copy.dart
```

