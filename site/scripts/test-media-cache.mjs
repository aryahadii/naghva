import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import sharp from 'sharp';

const script = fileURLToPath(new URL('./media.mjs', import.meta.url));
function run(cwd, command) {
  return execFileSync(process.execPath, [script, command], {
    cwd, encoding: 'utf8', env: { ...process.env, NAGHVA_MEDIA_REQUIRED: '', npm_config_cache: join(cwd, '.npm'), R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' },
  });
}

test('a restored npm cache reuses originals and copies on a fresh build', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'naghva-media-cache-'));
  try {
    const bytes = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#386342' } }).png().toBuffer();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const entry = { sha256, ext: 'png', width: 100, height: 80, widths: [60, 100, 240, 360] };
    writeFileSync(join(dir, 'media.json'), JSON.stringify({ 'https://example.com/a.png': entry, 'https://example.com/b.png': entry }));
    mkdirSync(join(dir, 'media-cache/originals'), { recursive: true });
    writeFileSync(join(dir, `media-cache/originals/${sha256}.png`), bytes);
    assert.match(run(dir, 'build'), /made 2 copies, reused 0/);
    const outputs = Object.fromEntries(readdirSync(join(dir, 'public/media')).map((name) => [name, readFileSync(join(dir, 'public/media', name))]));
    rmSync(join(dir, 'public'), { recursive: true });
    rmSync(join(dir, 'media-cache'), { recursive: true });
    mkdirSync(join(dir, '.npm/naghva-media/originals'), { recursive: true });
    writeFileSync(join(dir, `.npm/naghva-media/originals/${sha256}.png`), bytes);
    assert.match(run(dir, 'fetch'), /originals are cached/);
    assert.match(run(dir, 'build'), /made 0 copies, reused 2/);
    for (const [name, data] of Object.entries(outputs)) assert.deepEqual(readFileSync(join(dir, 'public/media', name)), data);
    const cachedCopies = readdirSync(join(dir, '.npm/naghva-media')).find((name) => name.startsWith('webp-v1-'));
    rmSync(join(dir, '.npm/naghva-media', cachedCopies, Object.keys(outputs)[0]));
    rmSync(join(dir, 'public'), { recursive: true });
    assert.match(run(dir, 'build'), /made 1 copies, reused 1/);
    const changedBytes = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#aa6644' } }).png().toBuffer();
    const changedHash = createHash('sha256').update(changedBytes).digest('hex');
    const changedEntry = { ...entry, sha256: changedHash };
    writeFileSync(join(dir, 'media.json'), JSON.stringify({ 'https://example.com/a.png': changedEntry }));
    writeFileSync(join(dir, `.npm/naghva-media/originals/${changedHash}.png`), changedBytes);
    assert.match(run(dir, 'build'), /made 2 copies, reused 0/);
    assert.ok(readdirSync(join(dir, 'public/media')).every((name) => name.startsWith(changedHash.slice(0, 16))));
    writeFileSync(join(dir, 'media.json'), JSON.stringify({ 'https://example.com/a.png': entry }));
    run(dir, 'build');
    writeFileSync(join(dir, 'public/media/obsolete.webp'), 'old');
    run(dir, 'build');
    assert.equal(readdirSync(join(dir, 'public/media')).length, 2);
    writeFileSync(join(dir, `.npm/naghva-media/originals/${sha256}.png`), 'corrupt');
    assert.throws(() => run(dir, 'fetch'), /does not match media.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
