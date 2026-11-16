import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { partsOf } from '../src/lib/dates.ts';

// derive turns Jalali dates into Gregorian ranges in Python; the site reads
// them back with the browser's Persian calendar. Both must agree.
const record = JSON.parse(readFileSync(new URL('../generated/record.json', import.meta.url), 'utf8'));

function jalaliDates(node, found = []) {
  if (Array.isArray(node)) node.forEach((n) => jalaliDates(n, found));
  else if (node && typeof node === 'object') {
    if (node.calendar === 'jalali' && typeof node.date === 'string' && node.range) {
      found.push(...(node.endpoints ?? [node]));
    } else Object.values(node).forEach((n) => jalaliDates(n, found));
  }
  return found;
}

const nextDay = (iso) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

test('every Jalali date in the record reads back as the same Jalali date', () => {
  const dates = jalaliDates(record).filter((v) => !v.date.includes('X'));
  assert.ok(dates.length > 100, `only ${dates.length} Jalali dates found`);
  for (const value of dates) {
    const [y, m, d] = value.date.replace(/[~?%]$/, '').split('-').map(Number);
    const start = partsOf(value.range[0], 'fa');
    assert.deepEqual(start, { y, m: m || 1, d: d || 1 }, `${value.date} starts ${value.range[0]}`);
    const after = partsOf(nextDay(value.range[1]), 'fa');
    if (d) assert.deepEqual(partsOf(value.range[1], 'fa'), start, `${value.date} ends ${value.range[1]}`);
    else assert.ok(after.d === 1 && (m || after.m === 1), `${value.date} ends ${value.range[1]}`);
  }
});
