#!/usr/bin/env node
/**
 * Scores repro-check against a corpus that has been *labelled by execution*,
 * and prints the confusion matrix.
 *
 * ## WHY THIS EXISTS
 *
 * `measure-corpus.mjs` answers "what does this tool say about real reports". It
 * cannot answer "is it right", because nothing in that corpus knows whether a
 * report could have been reproduced. This one takes a corpus where something
 * else already found out by running code, and asks whether repro-check's
 * verdict agrees.
 *
 * That comparison is not free of assumptions, and the honest reading is
 * narrow. repro-check reports the absence of things; a label saying a runnable
 * expression *was* derived from a report is evidence about the same report but
 * not about the same question. What the matrix measures is how well the one
 * predicts the other -- which is exactly what a maintainer is implicitly
 * assuming when they gate an issue on a blocking gap.
 *
 * ## THE LABELS
 *
 * A JSON file with a `rows` array. Each row needs:
 *
 *   { "slug": "owner/repo", "issue": 119, "admitted": true }
 *
 * `admitted` is the label: true when something runnable really was derived from
 * that report and shown to behave differently before and after the fix. A row
 * may carry the report text directly as `body` instead, in which case no cache
 * is read. Any extra field -- `bucket`, `expression` -- is ignored here.
 *
 * ## THE REPORT TEXT
 *
 * `--cache <dir>` points at a directory of `owner__repo.json` files, each an
 * array of `{ number, title, body }` as GitHub's API answered. The text scored
 * is the title, a blank line, then the body, which is how a reporter's issue
 * reads on the page.
 *
 * Usage:
 *   node scripts/measure-agreement.mjs <labels.json> --cache <dir>
 *
 * Nothing here opens a socket or calls a model. The numbers move when the
 * corpus does; re-run it rather than editing figures by hand.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkIssue } from '../dist/index.js';

const [labelPath, ...rest] = process.argv.slice(2);
const cacheAt = rest.indexOf('--cache');
const cacheDir = cacheAt === -1 ? null : rest[cacheAt + 1];
if (labelPath === undefined) {
  console.error('usage: node scripts/measure-agreement.mjs <labels.json> --cache <dir>');
  process.exit(2);
}

const labels = JSON.parse(readFileSync(labelPath, 'utf8'));
const rows = Array.isArray(labels) ? labels : labels.rows;
if (!Array.isArray(rows)) {
  console.error(`${labelPath}: expected an array, or an object with a "rows" array`);
  process.exit(2);
}

const cache = new Map();
function reportText(row) {
  if (typeof row.body === 'string') return row.body;
  if (cacheDir === undefined || cacheDir === null) return null;
  const file = join(cacheDir, `${String(row.slug).replace('/', '__')}.json`);
  if (!existsSync(file)) return null;
  if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(file, 'utf8')));
  const issue = cache.get(file).find((item) => item.number === row.issue);
  if (issue === undefined) return null;
  return `${issue.title ?? ''}\n\n${issue.body ?? ''}`;
}

/*
 * The prediction under test is the one a CI gate makes: no blocking gap means
 * the tool let the report through, which a maintainer reads as "this might be
 * reproducible". repro-check never says that itself -- the point of measuring
 * is to find out what that reading is worth.
 */
const cell = { tp: 0, fp: 0, tn: 0, fn: 0 };
const byCategory = new Map();
let skipped = 0;

for (const row of rows) {
  const text = reportText(row);
  if (text === null || text.trim() === '') { skipped += 1; continue; }
  const result = checkIssue(text);
  const letThrough = result.counts.blocking === 0;
  const runnable = row.admitted === true;
  cell[runnable ? (letThrough ? 'tp' : 'fn') : (letThrough ? 'fp' : 'tn')] += 1;
  for (const category of new Set(result.gaps.map((gap) => gap.category))) {
    const seen = byCategory.get(category) ?? { fired: 0, runnable: 0 };
    seen.fired += 1;
    if (runnable) seen.runnable += 1;
    byCategory.set(category, seen);
  }
}

const { tp, fp, tn, fn } = cell;
const scored = tp + fp + tn + fn;
if (scored === 0) {
  console.error('no rows could be scored -- check --cache');
  process.exit(2);
}
const pct = (n, of) => (of === 0 ? '   n/a' : `${((n / of) * 100).toFixed(1)}%`.padStart(6));

console.log(`scored: ${scored} reports (${skipped} skipped for missing text)`);
console.log(`labelled runnable: ${pct(tp + fn, scored)} (${tp + fn})   <- the base rate`);
console.log('');
console.log('                     labelled runnable   labelled not');
console.log(`  let through        ${String(tp).padStart(13)} ${String(fp).padStart(14)}`);
console.log(`  blocked            ${String(fn).padStart(13)} ${String(tn).padStart(14)}`);
console.log('');
console.log(`accuracy:  ${pct(tp + tn, scored)}`);
console.log(`precision: ${pct(tp, tp + fp)}  of the reports it let through, this share were runnable`);
console.log(`recall:    ${pct(tp, tp + fn)}  of the runnable reports, this share got through`);
console.log('');
console.log('per category -- share of the reports it fires on that were runnable:');
for (const [category, seen] of [...byCategory].sort((a, b) => b[1].fired - a[1].fired)) {
  console.log(`  ${category.padEnd(28)} ${String(seen.fired).padStart(4)} fired  ${pct(seen.runnable, seen.fired)} runnable`);
}
console.log('');
console.log('A category at the base rate carries no information about runnability.');
