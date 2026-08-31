#!/usr/bin/env node
/**
 * Asks whether any *cheap, computable* property of a bug report separates the
 * reports something runnable was derived from, from the reports it was not.
 *
 * ## WHY THIS EXISTS
 *
 * `measure-agreement.mjs` shows that repro-check's own categories carry almost
 * no information about runnability: nearly all of them sit within a point or
 * two of the corpus base rate. That is a fact about *those* categories, not
 * about the report text. Before anyone concludes the signal has to come from a
 * model, it is worth checking the cheapest thing available -- surface features
 * a regex can compute -- and finding out whether the signal is there.
 *
 * This script is measurement only. It changes no tool behaviour and feeds
 * nothing back into `checkIssue`. It exists so that the answer, positive or
 * negative, is a re-runnable number rather than a recollection.
 *
 * ## HOW TO READ IT
 *
 * Every feature is a predicate over the report text. For each one the output
 * gives the number of reports it holds on, the share of *those* that were
 * labelled runnable, and the lift in percentage points over the corpus base
 * rate. A feature within a couple of points of base carries no information,
 * however plausible it sounded.
 *
 * The feature list is FIXED and is written down before the numbers are read.
 * The count is printed with the results, because the more predicates you try
 * the more likely one clears a threshold by chance alone. Do not add a feature
 * because an existing one nearly worked, and do not adjust a threshold to
 * improve a row -- both fit the tool to this one sample.
 *
 * Numeric properties (length, line count, block count) are turned into
 * predicates by splitting at the corpus median rather than at a hand-picked
 * cut, so there is no threshold to tune.
 *
 * Usage:
 *   node scripts/measure-features.mjs <labels.json> --cache <dir>
 *
 * Same inputs as measure-agreement.mjs. Nothing here opens a socket or calls a
 * model.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [labelPath, ...rest] = process.argv.slice(2);
const cacheAt = rest.indexOf('--cache');
const cacheDir = cacheAt === -1 ? null : rest[cacheAt + 1];
if (labelPath === undefined) {
  console.error('usage: node scripts/measure-features.mjs <labels.json> --cache <dir>');
  process.exit(2);
}

const labels = JSON.parse(readFileSync(labelPath, 'utf8'));
const rows = Array.isArray(labels) ? labels : labels.rows;
if (!Array.isArray(rows)) {
  console.error(`${labelPath}: expected an array, or an object with a "rows" array`);
  process.exit(2);
}

const cache = new Map();
function report(row) {
  if (typeof row.body === 'string') return { title: '', body: row.body };
  if (cacheDir === null) return null;
  const file = join(cacheDir, `${String(row.slug).replace('/', '__')}.json`);
  if (!existsSync(file)) return null;
  if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(file, 'utf8')));
  const issue = cache.get(file).find((item) => item.number === row.issue);
  if (issue === undefined) return null;
  return { title: issue.title ?? '', body: issue.body ?? '' };
}

/* A fenced block is ```lang ... ```; the tag is whatever follows the fence. */
function fences(text) {
  const out = [];
  const re = /^[ \t]*```([^\n`]*)\n([\s\S]*?)^[ \t]*```/gm;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ tag: m[1].trim().toLowerCase(), code: m[2] });
  return out;
}

const JS_TAGS = new Set([
  'js', 'jsx', 'javascript', 'ts', 'tsx', 'typescript', 'mjs', 'cjs', 'node', 'json',
]);

/*
 * THE FEATURE LIST. Fixed before the numbers were read. Each entry is a
 * predicate over { title, body, text, blocks }.
 */
const FEATURES = [
  ['has fenced code block', (r) => r.blocks.length > 0],
  ['>= 2 fenced blocks', (r) => r.blocks.length >= 2],
  ['a block tagged JS/TS', (r) => r.blocks.some((b) => JS_TAGS.has(b.tag))],
  ['a block tagged anything', (r) => r.blocks.some((b) => b.tag !== '')],
  ['contains require( or import ', (r) => /\brequire\s*\(|^\s*import\s/m.test(r.text)],
  ['contains a call expression', (r) => /[A-Za-z_$][\w$.]*\s*\([^)]*\)/.test(r.text)],
  ['contains a stack trace', (r) => /^\s*at\s+\S+\s*\(?.*:\d+:\d+/m.test(r.text)],
  ['expected/actual pair', (r) => /\bexpect(ed)?\b/i.test(r.text) && /\b(actual|observed|instead|but got)\b/i.test(r.text)],
  ['contains a version string', (r) => /\bv?\d+\.\d+\.\d+\b/.test(r.text)],
  ['literal value assertion', (r) => /(===|==|toBe|toEqual|assert|should)\s*\(?\s*['"\d[{]/.test(r.text)],
  ['contains an error name', (r) => /\b\w*(Error|Exception)\b\s*[:(]/.test(r.text)],
  ['contains a URL', (r) => /https?:\/\//.test(r.text)],
  ['body longer than median', (r) => r.body.length > MEDIAN.bodyLen],
  ['body shorter than median', (r) => r.body.length <= MEDIAN.bodyLen],
  ['more lines than median', (r) => r.lines > MEDIAN.lines],
  ['title longer than median', (r) => r.title.length > MEDIAN.titleLen],
];

const scored = [];
let skipped = 0;
for (const row of rows) {
  const got = report(row);
  if (got === null || `${got.title}${got.body}`.trim() === '') { skipped += 1; continue; }
  const text = `${got.title}\n\n${got.body}`;
  scored.push({
    title: got.title,
    body: got.body,
    text,
    blocks: fences(got.body),
    lines: got.body.split('\n').length,
    runnable: row.admitted === true,
  });
}
if (scored.length === 0) {
  console.error('no rows could be scored -- check --cache');
  process.exit(2);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const MEDIAN = {
  bodyLen: median(scored.map((r) => r.body.length)),
  lines: median(scored.map((r) => r.lines)),
  titleLen: median(scored.map((r) => r.title.length)),
};

const total = scored.length;
const runnableTotal = scored.filter((r) => r.runnable).length;
const base = (runnableTotal / total) * 100;

console.log(`scored: ${total} reports (${skipped} skipped for missing text)`);
console.log(`base rate: ${base.toFixed(1)}% runnable (${runnableTotal})`);
console.log(`medians: body ${MEDIAN.bodyLen} chars, ${MEDIAN.lines} lines, title ${MEDIAN.titleLen} chars`);
console.log('');
console.log(`${FEATURES.length} features tried. Lift is percentage points over the base rate.`);
console.log('');
console.log('  feature                          held   runnable     lift');

const table = FEATURES.map(([name, holds]) => {
  const hit = scored.filter((r) => holds(r));
  const share = hit.length === 0 ? null : (hit.filter((r) => r.runnable).length / hit.length) * 100;
  return { name, held: hit.length, share };
}).sort((a, b) => (b.share ?? -1) - (a.share ?? -1));

for (const { name, held, share } of table) {
  const shareText = share === null ? '   n/a' : `${share.toFixed(1)}%`.padStart(6);
  const liftText = share === null ? '    n/a' : `${(share - base >= 0 ? '+' : '')}${(share - base).toFixed(1)}`.padStart(7);
  console.log(`  ${name.padEnd(32)} ${String(held).padStart(4)}  ${shareText}  ${liftText}`);
}
console.log('');
console.log('A feature within a couple of points of the base rate carries no information.');
console.log('With this many predicates tried, expect the largest lift to overstate itself.');
