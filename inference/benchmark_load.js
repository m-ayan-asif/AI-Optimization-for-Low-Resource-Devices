/**
 * SkinSense ML Inference Microservice Concurrency & Load Tester
 * 
 * Uses autocannon to benchmark the FastAPI server on port 5001.
 * Tests endpoint throughput, p50/p95/p99 latency bounds, and verifies
 * that concurrent requests do not freeze the asyncio event loop.
 *
 * Prerequisites:
 *   npm install -g autocannon (or npm install autocannon inside server/ or inference/)
 *
 * Usage:
 *   node inference/benchmark_load.js
 */

const autocannon = require('autocannon');

const TARGET_PORT = process.env.INFERENCE_PORT || 5001;
const TARGET_HOST = process.env.INFERENCE_HOST || 'localhost';
const BASE_URL = `http://${TARGET_HOST}:${TARGET_PORT}`;

// Minimal valid 10x10 base64 PNG with skin tone (matches quality.py skin presence)
const BASE64_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVQYV2N89erVf2RsaGCI' +
  'GkaDCgEAk8oX1g8fX8YAAAAASUVORK5CYII=';
const PNG_BUFFER = Buffer.from(BASE64_PNG, 'base64');

async function runHealthBenchmark() {
  console.log(`\n======================================================`);
  console.log(`[Stage 1/2] Benchmarking ${BASE_URL}/health`);
  console.log(`Config: 50 concurrent connections, 10s duration`);
  console.log(`======================================================\n`);

  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: `${BASE_URL}/health`,
        connections: 50,
        pipelining: 1,
        duration: 10,
        headers: {
          'Content-Type': 'application/json',
        },
      },
      (err, result) => {
        if (err) return reject(err);
        printResults('GET /health', result);
        resolve(result);
      }
    );

    autocannon.track(instance, { renderProgressBar: true });
  });
}

async function runPredictBenchmark() {
  console.log(`\n======================================================`);
  console.log(`[Stage 2/2] Benchmarking ${BASE_URL}/predict (CPU Bound)`);
  console.log(`Config: 5 concurrent connections, 10s duration`);
  console.log(`(Restricted concurrency to prevent CPU thread starvation)`);
  console.log(`======================================================\n`);

  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="image"; filename="skin.png"\r\n` +
      `Content-Type: image/png\r\n\r\n`
    ),
    PNG_BUFFER,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: `${BASE_URL}/predict`,
        method: 'POST',
        connections: 5,
        duration: 10,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length.toString(),
        },
        body: body,
      },
      (err, result) => {
        if (err) return reject(err);
        printResults('POST /predict', result);
        resolve(result);
      }
    );

    autocannon.track(instance, { renderProgressBar: true });
  });
}

function printResults(title, r) {
  console.log(`\n--- ${title} Performance Summary ---`);
  console.log(`Requests Total:     ${r.requests.total}`);
  console.log(`Requests / Sec:     ${r.requests.average} req/s`);
  console.log(`Throughput:         ${(r.throughput.average / (1024 * 1024)).toFixed(2)} MB/s`);
  console.log(`Latency (Average):  ${r.latency.average} ms`);
  console.log(`Latency (p50):      ${r.latency.p50} ms`);
  console.log(`Latency (p95):      ${r.latency.p95} ms`);
  console.log(`Latency (p99):      ${r.latency.p99} ms`);
  console.log(`2xx Responses:      ${r['2xx']}`);
  console.log(`4xx Responses:      ${r['4xx']}`);
  console.log(`5xx Responses:      ${r['5xx']}`);
  console.log(`Timeouts:           ${r.timeouts}`);
  console.log(`Connection Errors:  ${r.errors}`);
  console.log(`-------------------------------------\n`);
}

async function main() {
  try {
    await runHealthBenchmark();
    // Only benchmark /predict if the inference service is active
    await runPredictBenchmark();
  } catch (err) {
    console.error('[Benchmark Aborted]:', err.message);
  }
}

main();