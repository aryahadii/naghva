const SHA = /^[a-f0-9]{40}$/;

/**
 * The commit a build was made from, written to build.json. Cloudflare
 * Workers Builds deploys the site; this says which commit is live.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function buildIdentity(env = process.env) {
  const sha = env.NAGHVA_BUILD_SHA ?? env.GITHUB_SHA ?? env.WORKERS_CI_COMMIT_SHA;
  if (sha && SHA.test(sha)) return sha;
  if (sha || env.CI) throw new Error('A full commit SHA is required in NAGHVA_BUILD_SHA, GITHUB_SHA or WORKERS_CI_COMMIT_SHA for CI builds.');
  return 'local';
}
