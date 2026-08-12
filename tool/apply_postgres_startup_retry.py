from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

helper_anchor = "async function main() {\n"
helper = """const RETRYABLE_PG_STARTUP_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  '57P03',
  '53300',
]);

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRetryablePostgresStartupError(error) {
  const code = String(error?.code || '');
  return RETRYABLE_PG_STARTUP_CODES.has(code) || code.startsWith('08');
}

async function initSchemaWithRetry() {
  const maxAttempts = positiveInt(process.env.PG_STARTUP_RETRIES, 60);
  const delayMs = positiveInt(process.env.PG_STARTUP_RETRY_MS, 2000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await initSchema();
      if (attempt > 1) {
        console.log(`PostgreSQL became available on startup attempt ${attempt}/${maxAttempts}`);
      }
      return;
    } catch (error) {
      if (!isRetryablePostgresStartupError(error) || attempt >= maxAttempts) {
        throw error;
      }
      console.warn(`PostgreSQL not ready (${error.code || 'unknown'}), startup attempt ${attempt}/${maxAttempts}; retrying in ${delayMs}ms`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

"""

if 'async function initSchemaWithRetry()' not in source:
    if helper_anchor not in source:
        raise RuntimeError('main startup anchor missing')
    source = source.replace(helper_anchor, helper + helper_anchor, 1)

old_main = """async function main() {
  await initSchema();
"""
new_main = """async function main() {
  await initSchemaWithRetry();
"""
if old_main in source:
    source = source.replace(old_main, new_main, 1)
elif 'await initSchemaWithRetry();' not in source:
    raise RuntimeError('startup retry main replacement missing')

for token in [
    'async function initSchemaWithRetry()',
    'PG_STARTUP_RETRIES',
    'PG_STARTUP_RETRY_MS',
    'isRetryablePostgresStartupError',
    'await initSchemaWithRetry();',
]:
    if token not in source:
        raise RuntimeError(f'PostgreSQL startup retry token missing: {token}')

path.write_text(source, encoding='utf-8')
print('Production PostgreSQL startup retry applied')
