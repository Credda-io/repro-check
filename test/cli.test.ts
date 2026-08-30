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
  // `process.execArgv` is forwarded because the CLI is spawned as TypeScript.
  // A Node old enough to need `--experimental-strip-types` to load this test
  // file needs it to load `bin.ts` too, and a child does not inherit it. Without
  // this, every test in this file fails with ERR_UNKNOWN_FILE_EXTENSION on Node
  // 22.6 to 22.17 while the rest of the suite passes -- which reads like twelve
  // CLI bugs rather than one missing flag.
  const result = spawnSync(process.execPath, [...process.execArgv, BIN, ...args], {
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

/*
 * The three tests below cover inputs that carry no report. Each of them used to
 * render as a four-gap verdict -- the empty string is missing everything this
 * linter looks for -- so a mistyped path or a pipe that produced nothing came
 * back looking like a judgement about somebody's issue.
 */
test('an empty file is named as empty rather than reported as four gaps', () => {
  const result = run(['--no-color', fixturePath('empty')]);
  assert.equal(result.code, 2);
  assert.match(result.err, /is empty -- there is nothing to check/);
  assert.doesNotMatch(result.out, /no-reproduction-steps/);
});

test('an empty stdin is named as empty too', () => {
  const result = run(['--no-color', '-'], '   \n');
  assert.equal(result.code, 2);
  assert.match(result.err, /stdin is empty/);
});

test('a path that does not exist says what the three input shapes are', () => {
  const result = run(['--no-color', fixturePath('no-such-fixture')]);
  assert.equal(result.code, 2);
  assert.match(result.err, /no such file/);
  assert.match(result.err, /GitHub issue URL/);
  assert.doesNotMatch(result.err, /ENOENT/);
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

test('a --skip that names nothing is a usage error too', () => {
  // The same mistake as a typo'd category, written three other ways. Each of
  // these used to turn off no checks and say nothing about it, which is exactly
  // the silence the unknown-category error exists to prevent.
  assert.throws(() => parseArgs(['--skip']), /needs at least one category/);
  assert.throws(() => parseArgs(['--skip=']), /needs at least one category/);
  assert.throws(() => parseArgs(['--skip', ' , ,']), /needs at least one category/);
  assert.equal(run(['--skip', '--no-color', 'x.md']).code, 2);
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

/**
 * The README quotes two runs of the tool and the output each produces: the one
 * at the top of the file, which is the first thing anybody reads, and the
 * worked example further down. A worked example that no longer works is worse
 * than none, because a reader takes it for a description of the tool. So the
 * README is read here and compared, rather than trusted to whoever last
 * changed a message.
 *
 * The top block is `vague.md` under the name the README gives it. It went
 * unchecked until now for no better reason than that it names a file that does
 * not exist in this repository -- and it is the block with the most readers.
 */
for (const quote of [
  { marker: '$ npx repro-check issue.md\n', fixture: 'vague', name: 'issue.md' },
  {
    marker: '$ repro-check test/fixtures/readme-example.md\n',
    fixture: 'readme-example',
    name: 'test/fixtures/readme-example.md',
  },
]) {
  test(`the README's \`${quote.name}\` output is what the tool actually produces`, () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const start = readme.indexOf(quote.marker);
    assert.notEqual(start, -1, `the README no longer contains ${quote.name}`);
    const from = start + quote.marker.length;
    const quoted = readme.slice(from, readme.indexOf('\n```', from));

    const body = readFileSync(fixturePath(quote.fixture), 'utf8');
    const actual = formatText(checkIssue(body), { name: quote.name, color: false });

    assert.equal(actual.trimEnd(), quoted.trimEnd());
  });
}
