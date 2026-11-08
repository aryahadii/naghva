import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate, isoDate, originalDate } from '../src/lib/dates.ts';

const date = (text, start, end = start, calendar = 'gregorian') => ({date: text, calendar, range: [start, end]});
const interval = (left, right) => ({ date: `${left.date}/${right.date}`, calendar: left.calendar,
  range: [left.range[0], right.range[1]], endpoints: [left, right] });

test('exact Gregorian and Jalali dates retain existing precision and calendar conversion', () => {
  assert.equal(formatDate(date('2004-11-17', '2004-11-17'), 'en'), '17 November 2004');
  assert.equal(isoDate(date('2004', '2004-01-01', '2004-12-31')), '2004');
  assert.equal(isoDate(date('2004-11', '2004-11-01', '2004-11-30')), '2004-11');
  const jalali = date('1400-01-01', '2021-03-21', undefined, 'jalali');
  assert.equal(formatDate(jalali, 'en'), '21 March 2021');
  assert.match(formatDate(jalali, 'fa'), /۱۴۰۰/);
  assert.equal(isoDate(jalali), '2021-03-21');
});

test('intervals retain month/day precision, including mixed and cross-year endpoints', () => {
  const cases = [
    [date('2004-01', '2004-01-01', '2004-01-31'), date('2004-03', '2004-03-01', '2004-03-31'), 'January 2004 – March 2004'],
    [date('2004-12-25', '2004-12-25'), date('2005-01-02', '2005-01-02'), '25 December 2004 – 2 January 2005'],
    [date('2004', '2004-01-01', '2004-12-31'), date('2005-01', '2005-01-01', '2005-01-31'), '2004 – January 2005'],
  ];
  for (const [left, right, expected] of cases) assert.equal(formatDate(interval(left, right), 'en'), expected);
  const same = date('2004-01', '2004-01-01', '2004-01-31');
  assert.equal(formatDate(interval(same, same), 'en'), 'January 2004');
});

test('each interval endpoint retains its own uncertainty and original-calendar tooltip', () => {
  const left = date('1400-01~', '2021-03-21', '2021-04-20', 'jalali');
  const right = date('1400-03?', '2021-05-22', '2021-06-21', 'jalali');
  const value = interval(left, right);
  assert.equal(formatDate(value, 'en'), 'c. March–April 2021 – May–June 2021?');
  const original = originalDate(value, 'en');
  assert.match(original, /c\. Farvardin 1400/);
  assert.match(original, /Khordad 1400\?/);
  assert.equal(originalDate(value, 'fa'), null);
  assert.match(formatDate(value, 'fa'), /فروردین/);
  assert.match(formatDate(value, 'fa'), /خرداد/);
  const persian = originalDate(interval(date('2004-01', '2004-01-01', '2004-01-31'), date('2004-03?', '2004-03-01', '2004-03-31')), 'fa');
  assert.match(persian, /ژانویه/);
  assert.match(persian, /مارس/);
});

test('approximate, uncertain, decade and interval values never emit exact metadata', () => {
  for (const text of ['2004?', '2004~', '2004%', '200X', '2004/2004', '2004-11~', '2004-11-17?']) {
    assert.equal(isoDate(date(text, '2004-01-01', '2004-12-31')), null);
  }
  assert.equal(formatDate(interval(date('2004?', '2004-01-01', '2004-12-31'), date('2005~', '2005-01-01', '2005-12-31')), 'en'), '2004? – c. 2005');
});
