import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseArgs } from '../src/cli.ts';
import { checkIssue } from '../src/index.ts';
import { DISCLAIMER, formatGitHub, formatMarkdown, formatText } from '../src/format.ts';

const BIN = fileURLToPath(new URL('../src/bin.ts', import.meta.url));
const fixturePath = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}.md`, import.meta.url));

function run(args: readonly string[], input?: string): { code: number; out: string; err: string } {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    input: input ?? '',
  });
  return { code: result.status ?? -1, out: result.stdout, err: result.stderr };
}

test('a clean report exits 0 and says no gaps were found', () => {
  const result = run(['--no-color', fixturePath('clean')]);
  assert.equal(result.code, 0);
  assert.match(result.out, /no gaps found/);
});

test('a report with a blocking gap exits 1', () => {
  const result = run(['--no-color', fixturePath('unresolved')]);
  assert.equal(result.code, 1);
  assert.match(result.out, /unresolved-reference/);
  assert.match(result.out, /parseConfig/);
});

test('an advisory-only report exits 0, and 1 under --strict', () => {
  assert.equal(run(['--no-color', fixturePath('observed-only')]).code, 0);
  assert.equal(run(['--no-color', '--strict', fixturePath('observed-only')]).code, 1);
});

test('a body can be piped in on stdin', () => {
  const result = run(['--no-color', '-'], readFileSync(fixturePath('vague'), 'utf8'));
  assert.equal(result.code, 1);
  assert.match(result.out, /no-reproduction-steps/);
});

test('several inputs are all reported and the worst exit code wins', () => {
  const result = run(['--no-color', fixturePath('clean'), fixturePath('unresolved')]);
  assert.equal(result.code, 1);
  assert.match(result.out, /no gaps found/);
  assert.match(result.out, /unresolved-reference/);
});

test('--json emits parseable output carrying the same verdict', () => {
  const result = run(['--json', fixturePath('unresolved')]);
  const parsed = JSON.parse(result.out) as { verdict: string; gaps: Array<{ category: string }> };
  assert.equal(parsed.verdict, 'gaps-found');
  assert.ok(parsed.gaps.some((gap) => gap.category === 'unresolved-reference'));
});

test('--format github emits one annotation per gap', () => {
  const result = run(['--format', 'github', fixturePath('vague')]);
  const lines = result.out.trim().split('\n');
  assert.ok(lines.every((line) => /^::(error|warning) /.test(line)), result.out);
  assert.ok(lines.some((line) => line.includes('::warning')));
});

test('--explain lists every category and exits 0', () => {
  const result = run(['--explain']);
  assert.equal(result.code, 0);
  assert.match(result.out, /unresolved-reference/);
  assert.match(result.out, /no-failure-evidence/);
});

test('--help exits 0 and states what the tool cannot do', () => {
  const result = run(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.out, /cannot tell you/);
});

test('an unreadable file exits 2 rather than passing', () => {
  const result = run(['--no-color', fixturePath('does-not-exist')]);
  assert.equal(result.code, 2);
  assert.match(result.err, /repro-check:/);
});

test('an unknown option exits 2 with the usage text', () => {
  const result = run(['--nope']);
  assert.equal(result.code, 2);
  assert.match(result.err, /unknown option/);
});

test('a non-GitHub URL is refused rather than fetched', () => {
  const result = run(['https://example.test/issue/1']);
  assert.equal(result.code, 2);
  assert.match(result.err, /not a GitHub issue URL/);
});

test('arguments are parsed into the documented shape', () => {
  const options = parseArgs(['--strict', '--format=markdown', '--skip', 'no-version,no-environment', 'a.md']);
  assert.equal(options.strict, true);
  assert.equal(options.format, 'markdown');
  assert.deepEqual(options.skip, ['no-version', 'no-environment']);
  assert.deepEqual(options.inputs, ['a.md']);
});

test('an unknown skip category is a usage error, not a silent no-op', () => {
  assert.throws(() => parseArgs(['--skip', 'made-up']), /unknown category/);
});

test('every format carries the disclaimer, or in the case of annotations, no verdict', () => {
  const result = checkIssue(readFileSync(fixturePath('vague'), 'utf8'));
  assert.ok(formatText(result).includes(DISCLAIMER.slice(0, 40)));
  assert.ok(formatMarkdown(result).includes(DISCLAIMER));
  const clean = checkIssue(readFileSync(fixturePath('clean'), 'utf8'));
  assert.ok(formatText(clean).includes(DISCLAIMER.slice(0, 40)));
  assert.ok(formatMarkdown(clean).includes(DISCLAIMER));
  // Annotations are per-gap and make no claim about the report as a whole.
  assert.equal(formatGitHub(clean), '');
});

test('no rendering ever calls a report reproducible', () => {
  for (const name of ['clean', 'vague', 'unresolved', 'template']) {
    const result = checkIssue(readFileSync(fixturePath(name), 'utf8'));
    for (const text of [formatText(result), formatMarkdown(result), JSON.stringify(result)]) {
      // The word may appear only where the disclaimer denies the claim.
      const withoutDisclaimer = text.replace(/\s+/g, ' ').replace(DISCLAIMER, '');
      assert.ok(!/\breproducible\b/.test(withoutDisclaimer), `${name}: ${text}`);
      assert.ok(!/\bpasses\b|\blooks good\b|\bcomplete\b/i.test(text), name);
    }
  }
});
