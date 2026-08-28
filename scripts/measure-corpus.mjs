#!/usr/bin/env node
/**
 * Runs repro-check over a corpus of real issue bodies and prints the
 * distribution, so the figures in the README are something a reader can
 * re-derive rather than something they have to take on trust.
 *
 * ## WHY THIS EXISTS
 *
 * The README used to state a distribution over "1,583 open issue bodies from 38
 * popular JavaScript repositories" and this repository contained no corpus, no
 * harness and no script that produced it. For a tool whose entire pitch is that
 * it does not overclaim, an unreproducible measurement was the weakest sentence
 * in its own documentation.
 *
 * ## THE CORPUS
 *
 * A directory of JSON files, each one a page of GitHub's issues API exactly as
 * it answered -- so the bodies are the reporters' own text and nothing here has
 * edited them. Any directory in that shape works; the figures in the README came
 * from a harvest that is no longer public, which is precisely why this takes a
 * path rather than shipping one.
 *
 * To build your own, one page per call:
 *
 *   gh api '/repos/<owner>/<repo>/issues?state=open&per_page=100&page=1' \
 *     > cache/<owner>__<repo>--p1.json
 *
 * A file may be the bare array the API returns, or an object with that array in
 * a `body` field (as an HTTP cache writes it). Both are read.
 *
 * Usage:
 *   node scripts/measure-corpus.mjs <path-to-cache-dir>
 *
 * The numbers move when the corpus does. Re-run it rather than editing the
 * README's figures by hand.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkIssue } from '../dist/index.js';

const cacheDir = process.argv[2];
if (cacheDir === undefined) {
  console.error('usage: node scripts/measure-corpus.mjs <path-to-cache-dir>');
  process.exit(2);
}

/** Every issue body in the cache, with pull requests and empty bodies dropped. */
function bodies(dir) {
  const out = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const page = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    const items = typeof page.body === 'string' ? JSON.parse(page.body) : page.body;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      // A pull request is an issue to the API and is not a bug report; an empty
      // body has nothing to check and would only inflate every "missing" count.
      if (item === null || typeof item !== 'object') continue;
      if (item.pull_request !== undefined) continue;
      const body = typeof item.body === 'string' ? item.body : '';
      if (body.trim() === '') continue;
      out.push(body);
    }
  }
  return out;
}

const corpus = bodies(cacheDir);
if (corpus.length === 0) {
  console.error(`no issue bodies found under ${cacheDir}`);
  process.exit(2);
}

let anyGap = 0;
let noBlocking = 0;
const byCategory = new Map();

for (const body of corpus) {
  const result = checkIssue(body);
  if (result.gaps.length > 0) anyGap += 1;
  if (result.counts.blocking === 0) noBlocking += 1;

  // Counted once per report, not once per gap: the question the README answers
  // is "in what share of reports does this appear", and a report naming three
  // unresolved references is still one report.
  for (const category of new Set(result.gaps.map((gap) => gap.category))) {
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
  }
}

const pct = (n) => `${((n / corpus.length) * 100).toFixed(0)}%`;

console.log(`corpus: ${corpus.length} issue bodies`);
console.log(`at least one gap: ${pct(anyGap)} (${anyGap})`);
console.log(`no blocking gap:  ${pct(noBlocking)} (${noBlocking})`);
console.log('by category, share of reports:');
for (const [category, count] of [...byCategory].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${category.padEnd(28)} ${pct(count).padStart(4)}  (${count})`);
}
