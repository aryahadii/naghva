import assert from 'node:assert/strict';
import { test } from 'node:test';
import { regenerator } from '../integrations/regenerate.ts';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('edit bursts coalesce and running work finishes before a single pending rerun', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const pending = [];
  let runs = 0, reloads = 0;
  const queue = regenerator(() => { runs++; return new Promise((done) => pending.push(done)); }, () => reloads++, () => assert.fail('unexpected failure'), 10);
  queue.schedule(); queue.schedule(); queue.schedule();
  t.mock.timers.tick(10);
  assert.equal(runs, 1);
  queue.schedule(); queue.schedule();
  t.mock.timers.tick(10);
  assert.equal(runs, 1);
  pending.shift()(true); await flush();
  assert.equal(runs, 2);
  assert.equal(reloads, 0);
  pending.shift()(true); await flush();
  assert.equal(reloads, 1);
  queue.dispose();
});

test('failures preserve the last record and allow later edits to recover', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let runs = 0, failures = 0, reloads = 0;
  const queue = regenerator(async () => { if (++runs === 1) throw new Error('spawn failed'); return true; }, () => reloads++, () => failures++, 10);
  queue.schedule(); t.mock.timers.tick(10); await flush();
  assert.equal(failures, 1); assert.equal(reloads, 0);
  queue.schedule(); t.mock.timers.tick(10); await flush();
  assert.equal(runs, 2); assert.equal(reloads, 1);
  queue.schedule(); queue.dispose(); t.mock.timers.tick(10); await flush();
  assert.equal(runs, 2);
});
