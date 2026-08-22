const BASE = process.env.LOAD_BASE_URL || 'http://127.0.0.1:8080';
const DURATION_MS = Number(process.env.LOAD_DURATION_MS || 10000);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 25);

async function main() {
  const stopAt = Date.now() + DURATION_MS;
  const latencies = [];
  let ok = 0;
  let failed = 0;

  async function worker() {
    while (Date.now() < stopAt) {
      const started = performance.now();
      try {
        const response = await fetch(`${BASE}/health`, { headers: { Accept: 'application/json' } });
        await response.arrayBuffer();
        const elapsed = performance.now() - started;
        latencies.push(elapsed);
        if (response.ok) ok += 1; else failed += 1;
      } catch (_) {
        failed += 1;
      }
    }
  }

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  latencies.sort((a, b) => a - b);
  const percentile = (p) => latencies.length
    ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]
    : Infinity;
  const result = {
    durationSeconds: Number(elapsedSeconds.toFixed(2)),
    concurrency: CONCURRENCY,
    requests: ok + failed,
    successful: ok,
    failed,
    requestsPerSecond: Number((ok / elapsedSeconds).toFixed(2)),
    p50Ms: Number(percentile(0.50).toFixed(2)),
    p95Ms: Number(percentile(0.95).toFixed(2)),
    p99Ms: Number(percentile(0.99).toFixed(2)),
  };
  console.log(JSON.stringify(result, null, 2));
  if (failed > 0 || !Number.isFinite(result.p95Ms) || result.p95Ms > 2000) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
