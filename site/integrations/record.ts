import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { loadRecord } from '../src/lib/record';
import { regenerator } from './regenerate';
import { buildIdentity } from '../scripts/deployment.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));

/** Derives the record again when data/ changes in dev, and writes Cloudflare's files after a build. */
export default function record(): AstroIntegration {
  return {
    name: 'naghva-record',
    hooks: {
      'astro:server:setup': ({ server, logger }) => {
        const root = process.env.NAGHVA_DATA ?? '../data';
        const data = fileURLToPath(new URL(root.endsWith('/') ? root : root + '/', new URL('../', import.meta.url)));
        server.watcher.add(data);
        const regeneration = regenerator(
          () => new Promise<boolean>((resolve) => {
            const run = spawn('python3', ['tools/derive.py', '--root', data], { cwd: repo, stdio: 'inherit' });
            run.once('error', () => resolve(false));
            run.once('close', (code) => resolve(code === 0));
          }),
          () => server.ws.send({ type: 'full-reload' }),
          () => logger.error('derive failed; the pages still show the last good record'),
        );
        server.watcher.on('all', (_event, path) => {
          if (!path.startsWith(data)) return;
          regeneration.schedule();
        });
        server.httpServer?.once('close', () => regeneration.dispose());
      },
      'astro:build:start': () => { buildIdentity(); },
      'astro:build:done': async ({ dir }) => {
        const { redirects } = loadRecord();
        const lines = redirects.map((r) => `${r.from} ${r.to} 301`);
        await writeFile(new URL('_redirects', dir), lines.join('\n') + '\n');
        await writeFile(new URL('build.json', dir), JSON.stringify({ sha: buildIdentity() }) + '\n');
      },
    },
  };
}
