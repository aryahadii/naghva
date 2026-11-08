import { execFile } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/;

/** @param {NodeJS.ProcessEnv} [env] */
export function buildIdentity(env = process.env) {
  const sha = env.NAGHVA_BUILD_SHA ?? env.GITHUB_SHA;
  if (sha && SHA.test(sha)) return sha;
  if (sha || env.CI) throw new Error('A full commit SHA is required in NAGHVA_BUILD_SHA or GITHUB_SHA for CI builds.');
  return 'local';
}

/** @param {string} sha @param {() => Promise<string>} [lookup] */
export async function isCurrentBuild(sha, lookup = async () =>
  (await exec('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'], { timeout: 30_000 })).stdout) {
  if (!SHA.test(sha)) throw new Error('Invalid workflow commit SHA.');
  const remote = (await lookup()).trim().split(/\s+/);
  if (remote.length !== 2 || !SHA.test(remote[0]) || remote[1] !== 'refs/heads/main') {
    throw new Error('Cannot establish the current main commit; deployment blocked.');
  }
  return remote[0] === sha;
}

/**
 * @param {string} sha
 * @param {{domains?: string[], attempts?: number, delayMs?: number, fetcher?: typeof fetch, pause?: (ms: number) => Promise<void>}} [options]
 */
export async function verifyDeployment(sha, {
  domains = ['naghva.com', 'naqva.com'], attempts = 7, delayMs = 10_000,
  fetcher = fetch, pause = (ms) => new Promise((done) => setTimeout(done, ms)),
} = {}) {
  if (!SHA.test(sha)) throw new Error('Invalid artifact commit SHA.');
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      for (const domain of domains) {
        const query = new URLSearchParams({ build: sha, attempt: String(attempt), t: String(Date.now()) });
        const response = await fetcher(`https://${domain}/build.json?${query}`, {
          headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok || (await response.json()).sha !== sha) throw new Error(`${domain} is not serving ${sha}`);
        for (const path of ['fa/', 'en/', 'sitemap-index.xml']) {
          const page = await fetcher(`https://${domain}/${path}`, { signal: AbortSignal.timeout(10_000) });
          if (!page.ok) throw new Error(`${domain}/${path}: HTTP ${page.status}`);
          await page.body?.cancel();
        }
      }
      return;
    } catch (error) { lastError = error; }
    if (attempt + 1 < attempts) await pause(delayMs);
  }
  throw new Error(`Deployment verification failed: ${lastError}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifact = JSON.parse(readFileSync('dist/build.json', 'utf8'));
  if (artifact.sha !== buildIdentity()) throw new Error('Artifact SHA does not match the workflow SHA.');
  if (process.argv[2] === 'guard') {
    const current = await isCurrentBuild(artifact.sha);
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.');
    appendFileSync(process.env.GITHUB_OUTPUT, `current=${current}\n`);
    if (!current) console.log('Skipping obsolete production build.');
  } else if (process.argv[2] === 'verify') {
    await verifyDeployment(artifact.sha);
    console.log(`Both public domains serve ${artifact.sha}; pages and sitemap are available.`);
  } else throw new Error('Usage: node scripts/deployment.mjs guard|verify');
}
