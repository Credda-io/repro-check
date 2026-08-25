import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkIssue, exitCodeFor } from '../src/index.ts';
import { ALL_CATEGORIES, CATEGORY_DESCRIPTIONS, type GapCategory } from '../src/types.ts';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}.md`, import.meta.url), 'utf8');

const categories = (name: string): GapCategory[] =>
  [...new Set(checkIssue(fixture(name)).gaps.map((gap) => gap.category))].sort();

test('a report with nothing missing produces no gaps at all', () => {
  const result = checkIssue(fixture('clean'));
  assert.deepEqual(result.gaps, []);
  assert.equal(result.verdict, 'no-gaps-found');
  assert.equal(result.checked.length, ALL_CATEGORIES.length);
  assert.equal(exitCodeFor(result), 0);
  assert.equal(exitCodeFor(result, { strict: true }), 0);
});

test('unfilled-template: an empty template section is named', () => {
  const gaps = checkIssue(fixture('template')).gaps.filter((gap) => gap.category === 'unfilled-template');
  assert.ok(gaps.length >= 1);
  assert.match(gaps[0].message, /Describe the bug/);
  assert.equal(gaps[0].severity, 'blocking');
  assert.equal(typeof gaps[0].line, 'number');
});

test('unfilled-template: an empty section that no reproduction needs is advisory', () => {
  const body = [
    '### Describe the bug', '', 'It returns `null` where it should return `3`.', '',
    '### Version', '', '2.1.0 on Node.js 22, Linux.', '',
    '### Steps', '', '```js', "const { run } = require('thing');", 'console.log(run());', '```', '',
    '### Additional context', '', '_No response_',
  ].join('\n');
  const gaps = checkIssue(body).gaps.filter((gap) => gap.category === 'unfilled-template');
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].message, /Additional context/);
  assert.equal(gaps[0].severity, 'advisory');
});

test('unfilled-template: a run of adjacent empty sections is reported once each at most', () => {
  const gaps = checkIssue(fixture('template')).gaps.filter((gap) => gap.category === 'unfilled-template');
  const lines = gaps.map((gap) => gap.line);
  assert.equal(new Set(lines).size, lines.length);
});

test('no-reproduction-steps: prose with no code, command, steps or link', () => {
  assert.ok(categories('vague').includes('no-reproduction-steps'));
});

test('no-reproduction-steps: a snippet is enough to satisfy it', () => {
  assert.ok(!categories('unresolved').includes('no-reproduction-steps'));
});

test('incomplete-snippet: an unclosed brace', () => {
  const gaps = checkIssue(fixture('incomplete')).gaps.filter((gap) => gap.category === 'incomplete-snippet');
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].message, /opens `\{` and never closes it/);
});

test('incomplete-snippet: an elision standing in for code', () => {
  const gaps = checkIssue(fixture('elided')).gaps.filter((gap) => gap.category === 'incomplete-snippet');
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].message, /elides part of itself/);
  assert.match(gaps[0].evidence ?? '', /the rest of our setup/);
});

test('unresolved-reference: a called name nothing defines', () => {
  const gaps = checkIssue(fixture('unresolved')).gaps.filter((gap) => gap.category === 'unresolved-reference');
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].message, /`parseConfig`/);
  assert.match(gaps[0].message, /nothing in it defines, imports or receives/);
});

test('unresolved-reference: a fragment is left to incomplete-snippet', () => {
  // Reading a truncated paste as a whole program invents names, so it is not read.
  assert.ok(!categories('incomplete').includes('unresolved-reference'));
});

test('unresolved-reference: an untagged block that looks like JavaScript is read', () => {
  const body = [
    'Version 1.0.0 on Node 22, macOS.', '', '```',
    "const { load } = require('thing');",
    'console.log(parseConfig(load()));',
    '```', '', 'It should print `3`; it prints `undefined`.',
  ].join('\n');
  const gaps = checkIssue(body).gaps.filter((gap) => gap.category === 'unresolved-reference');
  assert.deepEqual(gaps.map((gap) => gap.message.includes('parseConfig')), [true]);
});

test('unresolved-reference: a snippet in another language is left alone', () => {
  const body = [
    'Version 1.0.0 on Python 3.12, macOS.', '', '```python',
    'settings = parse_config(load("app.conf"))',
    'print(settings.retries)',
    '```', '', 'It should print `3`; it prints `None`.',
  ].join('\n');
  const found = checkIssue(body).gaps.map((gap) => gap.category);
  assert.ok(!found.includes('unresolved-reference'), JSON.stringify(found));
  assert.ok(!found.includes('no-reproduction-steps'));
});

test('a block handed over as output is not read as a program', () => {
  const body = [
    'Version 1.0.0 on Node 22, Linux.', '', 'Steps:', '', '```js',
    "const { run } = require('thing');",
    'console.log(run());',
    '```', '', 'It prints:', '', '```js',
    'someGeneratedThing.value = 1;',
    '```', '', 'It should print `3`.',
  ].join('\n');
  const found = checkIssue(body).gaps.map((gap) => gap.category);
  assert.ok(!found.includes('unresolved-reference'), JSON.stringify(found));
});

test('missing-fixture: a file the snippet reads but the report never shows', () => {
  const gaps = checkIssue(fixture('fixture')).gaps.filter((gap) => gap.category === 'missing-fixture');
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].message, /`deploy\.yaml`/);
});

test('missing-fixture: a file whose contents are elsewhere in the report is not a gap', () => {
  const body = [
    '### Environment', '', 'yamlish 4.1.0 on Node.js 22.4.0, Ubuntu 24.04.', '',
    '`deploy.yaml`:', '', '```yaml', 'stages: [a, b]', '```', '',
    '### Reproduction', '', '```js',
    "const { readFileSync } = require('node:fs');",
    "const { parse } = require('yamlish');",
    "console.log(parse(readFileSync('deploy.yaml', 'utf8')).stages.length);",
    '```', '',
    '### Expected', '', '`2`.', '',
    '### Actual', '', '`1`.',
  ].join('\n');
  const found = checkIssue(body).gaps.map((gap) => gap.category);
  assert.ok(!found.includes('missing-fixture'), JSON.stringify(found));
});

test('no-version: nothing anywhere carries a version number', () => {
  assert.ok(categories('vague').includes('no-version'));
});

test('no-version: a two-part number next to a version word counts', () => {
  const result = checkIssue('Running on Node 22.4 with npm. It crashes.\n\n```js\nrun();\n```');
  assert.ok(!result.gaps.some((gap) => gap.category === 'no-version'));
});

test('no-version: a bare two-part number in output is not read as a version', () => {
  const result = checkIssue('It is broken.\n\n```\nresult: 1.5\n```');
  assert.ok(result.gaps.some((gap) => gap.category === 'no-version'));
});

test('no-environment is advisory and does not fail a default run', () => {
  const body = [
    'Version 2.3.1 breaks it.', '',
    '```js',
    "const { run } = require('thing');",
    'console.log(run());',
    '```', '',
    'It should print `3`. I get `null` instead.',
  ].join('\n');
  const result = checkIssue(body);
  const gap = result.gaps.find((one) => one.category === 'no-environment');
  assert.ok(gap);
  assert.equal(gap.severity, 'advisory');
  assert.equal(exitCodeFor(result), 0);
  assert.equal(exitCodeFor(result, { strict: true }), 1);
});

test('expected-without-observed: what should happen, with no what did happen', () => {
  const gaps = checkIssue(fixture('expected-only')).gaps.filter((gap) => gap.category === 'expected-without-observed');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].severity, 'blocking');
});

test('observed-without-expected: what happened, with no what should have', () => {
  const gaps = checkIssue(fixture('observed-only')).gaps.filter((gap) => gap.category === 'observed-without-expected');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].severity, 'advisory');
});

test('the two value gaps are never reported against the same report', () => {
  for (const name of ['clean', 'expected-only', 'observed-only', 'vague', 'template']) {
    const found = categories(name);
    assert.ok(
      !(found.includes('expected-without-observed') && found.includes('observed-without-expected')),
      name,
    );
  }
});

test('no-failure-evidence: no error, no stack, no observed value', () => {
  assert.ok(categories('vague').includes('no-failure-evidence'));
});

test('no-failure-evidence: a pasted stack trace satisfies it', () => {
  const body = [
    'Version 1.2.3 on Node 22, Linux.', '', '```', 'TypeError: x is not a function',
    '    at run (/app/index.js:4:11)', '```',
  ].join('\n');
  assert.ok(!checkIssue(body).gaps.some((gap) => gap.category === 'no-failure-evidence'));
});

test('no-failure-evidence is not said twice alongside expected-without-observed', () => {
  const found = categories('expected-only');
  assert.ok(found.includes('expected-without-observed'));
  assert.ok(!found.includes('no-failure-evidence'));
});

test('skipping a category removes it from both the gaps and the checked list', () => {
  const result = checkIssue(fixture('vague'), { skip: ['no-version', 'no-environment'] });
  assert.ok(!result.checked.includes('no-version'));
  assert.ok(!result.gaps.some((gap) => gap.category === 'no-version'));
  assert.ok(!result.gaps.some((gap) => gap.category === 'no-environment'));
});

test('every category has a description and a check', () => {
  for (const category of ALL_CATEGORIES) {
    assert.equal(typeof CATEGORY_DESCRIPTIONS[category], 'string');
    assert.ok(CATEGORY_DESCRIPTIONS[category].length > 20, category);
  }
  assert.equal(new Set(ALL_CATEGORIES).size, ALL_CATEGORIES.length);
});

test('checking the same body twice gives the same answer', () => {
  const body = fixture('vague');
  assert.deepEqual(checkIssue(body), checkIssue(body));
});

test('an empty body does not throw and reports gaps rather than a pass', () => {
  const result = checkIssue('');
  assert.equal(result.verdict, 'gaps-found');
  assert.ok(result.counts.blocking > 0);
});
