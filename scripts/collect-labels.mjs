#!/usr/bin/env node
/**
 * Merges every execution-labelled harvest artifact into one label set for
 * `measure-agreement.mjs`, and prints it on stdout.
 *
 * ## WHY THIS EXISTS
 *
 * The first agreement run scored one artifact -- the model-proposed
 * differential, 616 rows. Three more runs of the same admission test exist,
 * over different repository pools and a different claim parser, and they are
 * labelled the same way: a case is admitted only when the reporter expression
 * was executed at the pinned commit and at the maintainer's fix commit and
 * behaved differently. Scoring one of the four throws away the rest.
 *
 * ## WHAT IS A LABEL AND WHAT IS NOT
 *
 * `admitted` means an expression really ran and really changed. That is a fact
 * about the report.
 *
 * A rejection is only a fact about the report when the harness got far enough
 * to learn something about it. Three rejection reasons never do:
 *
 *   NO_PARENT_COMMIT      the fix commit has no first parent to pin against
 *   NOT_LOADABLE_AT_PIN   the package would not load at the pin
 *   PROVISION_FAILED      the checkout could not be provisioned at all
 *
 * Those rows are about the repository and about this harness. A report that
 * loses its pin is not thereby a worse report, so labelling it "not runnable"
 * puts noise in the negative class and flatters any tool measured against it.
 * They are emitted with `admitted: false` and `harnessSide: true`, so the same
 * file can be scored both ways; `--executed-only` drops them.
 *
 * Usage:
 *   node scripts/collect-labels.mjs <bench/harvested> [--executed-only]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [root, ...flags] = process.argv.slice(2);
if (root === undefined) {
  console.error('usage: node scripts/collect-labels.mjs <bench/harvested> [--executed-only]');
  process.exit(2);
}
const executedOnly = flags.includes('--executed-only');

/* Rejection reasons that describe the harness or the repository, not the report. */
const HARNESS_SIDE = new Set(['NO_PARENT_COMMIT', 'NOT_LOADABLE_AT_PIN', 'PROVISION_FAILED']);

const ARTIFACTS = [
  ['model-proposed-differential.json', 'model-proposed'],
  ['scorecard.json', 'mechanically-parsed'],
  ['expansion/scorecard-yield-selected.json', 'mechanically-parsed'],
  ['binding-widening-slice-scorecard.json', 'mechanically-parsed'],
];

/* An id is `<repo-tail>-<issue>`; the issue URL carries the slug the cache is keyed by. */
function fromUrl(url) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(String(url));
  return m === null ? null : { slug: `${m[1]}/${m[2]}`, issue: Number(m[3]) };
}

/* Admitted cases are listed by id alone; the case directory holds the issue URL. */
function fromCase(id) {
  const file = join(root, id, 'case.json');
  if (!existsSync(file)) return null;
  const source = JSON.parse(readFileSync(file, 'utf8')).source ?? {};
  return fromUrl(source.issue);
}

/* An admitted case that never became a corpus directory has neither a URL nor a
 * case.json. Its id prefix is the package name, which the rejections from the
 * same run do carry a URL for. */
function fromSiblings(id, rejections) {
  const prefix = id.slice(0, id.lastIndexOf('-'));
  const issue = Number(id.slice(id.lastIndexOf('-') + 1));
  for (const row of rejections) {
    if (typeof row.id !== 'string' || row.id.slice(0, row.id.lastIndexOf('-')) !== prefix) continue;
    const where = fromUrl(row.issue);
    if (where !== null) return { slug: where.slug, issue };
  }
  return null;
}

const byId = new Map();
function add(id, row) {
  const seen = byId.get(id);
  /* The same report can appear in two runs. Admission is the stronger fact: an
   * expression that ran and changed cannot be un-run by another pool's pin
   * failing, so a true label wins and a harness-side one loses. */
  if (seen !== undefined) {
    if (seen.admitted || !row.admitted) return;
    byId.delete(id);
  }
  byId.set(id, row);
}

const provenance = [];
for (const [file, claimSource] of ARTIFACTS) {
  const path = join(root, file);
  if (!existsSync(path)) { console.error(`missing: ${path}`); process.exit(2); }
  const artifact = JSON.parse(readFileSync(path, 'utf8'));
  const admitted = artifact.admitted ?? [];
  const rejections = artifact.rejections ?? [];
  let kept = 0;

  /* model-proposed-differential.json carries every row, admitted and not, in
   * `rows`; the scorecards split them into an id list and a rejection list. */
  const rows = Array.isArray(artifact.rows)
    ? artifact.rows.map((row) => ({ id: row.id, slug: row.slug, issue: row.issue, admitted: row.admitted === true, reason: row.reason }))
    : [
        ...(Array.isArray(admitted) ? admitted : []).map((id) => ({ id, admitted: true, reason: null })),
        ...rejections.map((row) => ({ id: row.id, issue: row.issue, admitted: false, reason: row.reason })),
      ];

  for (const row of rows) {
    const where = row.slug === undefined ? (fromUrl(row.issue) ?? fromCase(row.id) ?? fromSiblings(row.id, rejections)) : { slug: row.slug, issue: row.issue };
    if (where === null) { console.error(`no issue URL for ${row.id} (${file})`); continue; }
    const harnessSide = !row.admitted && HARNESS_SIDE.has(String(row.reason));
    if (executedOnly && harnessSide) continue;
    add(row.id, { id: row.id, ...where, admitted: row.admitted, reason: row.reason ?? null, claimSource, harnessSide });
    kept += 1;
  }
  provenance.push({ artifact: file, claimSource, rows: rows.length, kept });
}

const rows = [...byId.values()];
process.stdout.write(`${JSON.stringify({
  generatedAt: new Date().toISOString(),
  note: 'Merged execution labels. Generated by repro-check/scripts/collect-labels.mjs; do not hand-edit.',
  admissionRule: 'A case is admitted only if the reporter expression, executed at the pinned commit, behaves as the report describes, AND the same expression executed at the maintainer fix commit does not.',
  executedOnly,
  sources: provenance,
  admitted: rows.filter((row) => row.admitted).length,
  harnessSide: rows.filter((row) => row.harnessSide).length,
  rows,
}, null, 2)}\n`);
