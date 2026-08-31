/**
 * Every entry in the three signal lists is the one that decides a line.
 *
 * WHY THIS EXISTS. `ERROR_PATTERNS`, `PLACEHOLDERS` and `VERSION_PATTERNS` are
 * the lists that decide whether a report carries failure evidence, whether a
 * template section was filled in, and whether a version was given. They are
 * the product's own heuristics, and until now nothing required any single
 * entry to have decided anything.
 *
 * MEASURED 2026-08-30, by wrapping `RegExp.prototype.test`/`exec` for a whole
 * `npm test` run and recording which patterns ever returned a match: five of
 * the ten error patterns (`panic:`, a segfault, `exit code N`, `FATAL ERROR`,
 * and the `ERR_*`/`EACCES` family) never matched anything the suite fed them.
 * Deleting all five left 87 tests passing and zero failing -- while turning
 * every Go panic, every crashed process and every `ENOENT` report into a
 * `no-failure-evidence` gap that the report does not deserve. Four of the six
 * version patterns and ten of the eleven placeholders were in the same state.
 *
 * So each entry now carries a sample, and the sample is asserted twice: at the
 * pattern, and through `checkIssue()`, against a baseline of the same report
 * with the sample taken out. A pattern that decides nothing fails here.
 *
 * Order matters for the two lists read by `firstOf()` -- the first pattern to
 * match is the one that answers -- so each sample is asserted to be claimed by
 * NO EARLIER pattern. `PLACEHOLDERS` is read with `.some()` and has no order,
 * so its samples are asserted to be claimed by no OTHER entry at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkIssue } from '../src/index.ts';

const source = readFileSync(new URL('../src/signals.ts', import.meta.url), 'utf8');

/** The regex literals of one `const NAME: readonly RegExp[] = [...]` block. */
function literalsOf(name: string): string[] {
  const block = new RegExp(`const ${name}: readonly RegExp\\[\\] = \\[([\\s\\S]*?)\\n\\];`).exec(source);
  assert.ok(block !== null, `${name} is not a list in signals.ts any more`);
  return (block?.[1] ?? '')
    .split('\n')
    .map((line) => /^\s*(\/.*\/[a-z]*),\s*$/.exec(line.trim())?.[1])
    .filter((literal): literal is string => literal !== undefined);
}

function compile(literal: string): RegExp {
  const parts = /^\/([\s\S]*)\/([a-z]*)$/.exec(literal);
  assert.ok(parts !== null, `not a regex literal: ${literal}`);
  return new RegExp(parts?.[1] ?? '', parts?.[2] ?? '');
}

function categories(body: string): string[] {
  return [...new Set(checkIssue(body).gaps.map((gap) => gap.category))];
}

/* ------------------------------------------------------------------ errors */

const ERROR_SAMPLES: Readonly<Record<string, string>> = {
  '/^\\s*(?:Uncaught\\s+)?(?:[A-Z][A-Za-z]*)?(?:Error|Exception)\\b(?:\\s*\\[[^\\]\\n]+\\])?\\s*[:!]/m':
    'TypeError: cannot read length of undefined',
  '/^\\s*Traceback \\(most recent call last\\)/m': 'Traceback (most recent call last)',
  '/^\\s{2,}at\\s+\\S+/m': '    at Object.run (/srv/app/index.js:12:9)',
  '/^\\s*File "[^"]+", line \\d+/m': 'File "app/main.py", line 41',
  '/\\bnpm ERR!/': 'npm ERR! code ELIFECYCLE',
  '/^\\s*panic:/m': 'panic: runtime error: index out of range [3]',
  '/\\bSegmentation fault\\b|\\bcore dumped\\b|\\bSIG(?:SEGV|ABRT|KILL)\\b/':
    'Segmentation fault (core dumped)',
  '/\\bexit(?:ed with)? code [1-9]\\d*\\b/i': 'The task exited with code 137.',
  '/\\bFATAL ERROR\\b/': 'FATAL ERROR: Ineffective mark-compacts near heap limit',
  '/\\b(?:ERR_[A-Z_]+|E[A-Z]{3,})\\b/': 'the call rejects with ENOENT',
};

/** A report that is complete except that nothing in it is failure evidence. */
function reportWithout(evidence: string): string {
  return [
    '### Describe the bug', '', 'Calling it twice breaks the second call.', '',
    '### Version', '', '2.1.0 on Node.js 22, Linux.', '',
    '### Steps', '', '```js', "const { run } = require('thing');", 'run();', 'run();', '```', '',
    ...(evidence === '' ? [] : ['### Output', '', '```text', evidence, '```']),
  ].join('\n');
}

test('the error-pattern list is the one being audited, so an empty pass cannot be a false one', () => {
  assert.equal(literalsOf('ERROR_PATTERNS').length, Object.keys(ERROR_SAMPLES).length);
  assert.deepEqual(literalsOf('ERROR_PATTERNS').slice().sort(), Object.keys(ERROR_SAMPLES).sort());
});

test('with no failure evidence at all, the gap this list suppresses is reported', () => {
  assert.ok(categories(reportWithout('')).includes('no-failure-evidence'));
});

for (const [index, literal] of literalsOf('ERROR_PATTERNS').entries()) {
  test(`error pattern ${literal} is the one that decides its sample`, () => {
    const sample = ERROR_SAMPLES[literal];
    assert.ok(sample !== undefined, `no sample for ${literal}`);
    assert.ok(compile(literal).test(sample), `${literal} does not match its own sample`);

    /* No earlier pattern may claim it, or this one never decides anything. */
    for (const earlier of literalsOf('ERROR_PATTERNS').slice(0, index)) {
      assert.ok(
        !compile(earlier).test(sample),
        `${earlier} matches the sample for ${literal} and answers first`,
      );
    }

    /* And it decides through the public entry point, not just in isolation. */
    assert.ok(!categories(reportWithout(sample)).includes('no-failure-evidence'));
  });
}

/* ------------------------------------------------------------ placeholders */

const PLACEHOLDER_SAMPLES: Readonly<Record<string, string>> = {
  '/^a clear and concise description/i': 'A clear and concise description of what the bug is.',
  '/^steps to reproduce the behaviou?r/i': 'Steps to reproduce the behavior:',
  '/^(?:add )?any other context/i': 'Add any other context about the problem.',
  '/^if applicable,? add/i': 'If applicable, add screenshots to help explain your problem.',
  '/^describe the bug/i': 'Describe the bug you are seeing.',
  '/^(?:please )?(?:paste|put|write|add|insert)\\b.{0,40}\\bhere\\b/i': 'Paste your output here',
  '/^e\\.?g\\.?[\\s:]/i': 'e.g. macOS 15, Node 22',
  '/^(?:replace|fill) (?:this|in)\\b/i': 'Replace this with your reproduction',
  '/^(?:todo|tbd|n\\/?a|none|nil|\\.{2,}|…|-{1,3}|\\?+)$/i': 'TBD',
  '/^no response$/i': '_No response_',
  '/^your (?:answer|code|output|version)\\b/i': 'Your version of the package',
};

/** The same report with one section body swapped for the text under test. */
function reportWithSection(body: string): string {
  return [
    '### Describe the bug', '', 'It returns `null` where it should return `3`.', '',
    '### Version', '', '2.1.0 on Node.js 22, Linux.', '',
    '### Steps', '', '```js', "const { run } = require('thing');", 'console.log(run());', '```', '',
    '### Additional context', '', body,
  ].join('\n');
}

test('the placeholder list is the one being audited', () => {
  assert.deepEqual(literalsOf('PLACEHOLDERS').slice().sort(), Object.keys(PLACEHOLDER_SAMPLES).sort());
});

test('a section with real content in it is not reported as unfilled', () => {
  assert.ok(!categories(reportWithSection('It also happens on Windows.')).includes('unfilled-template'));
});

for (const literal of literalsOf('PLACEHOLDERS')) {
  test(`placeholder ${literal} is the one that decides its sample`, () => {
    const sample = PLACEHOLDER_SAMPLES[literal];
    assert.ok(sample !== undefined, `no sample for ${literal}`);

    /* `isEffectivelyEmpty` flattens the body before matching, so the sample is
     * flattened here the same way rather than matched raw. */
    const flat = sample.replace(/<!--[\s\S]*?-->/g, '').trim().replace(/[*_`>#\-\s]+/g, ' ').trim();
    assert.ok(compile(literal).test(flat), `${literal} does not match its own sample`);

    /* No OTHER entry may claim it: the list is read with `.some()` and has no
     * order, so an entry claimed by a sibling decides nothing anywhere. */
    for (const other of literalsOf('PLACEHOLDERS')) {
      if (other === literal) continue;
      assert.ok(!compile(other).test(flat), `${other} also claims the sample for ${literal}`);
    }

    assert.ok(categories(reportWithSection(sample)).includes('unfilled-template'));
  });
}

/* ---------------------------------------------------------------- versions */

const VERSION_SAMPLES: Readonly<Record<string, string>> = {
  '/\\bv?\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.+-]+)?\\b/': 'Seen in 4.2.1-beta.3 of the library.',
  '/\\b(?:version|versions|release|running|using|on|installed|upgraded?|since|affected)\\b\\W{0,12}v?\\d+\\.\\d+/i':
    'Upgraded: v4.2 and it started.',
  '/\\bv?\\d+\\.\\d+\\b\\W{0,12}(?:and (?:above|later|newer)|or (?:later|newer|above)|onwards?)\\b/i':
    'Happens in 4.2 and later.',
  '/["\'][^"\'\\n]{1,60}["\']\\s*:\\s*["\'][\\^~>=<\\s]*\\d+\\.\\d+/': '"the-library": "^4.2"',
  '/[@=]\\s*\\^?~?v?\\d+\\.\\d+/': 'installed the-library@4.2',
  '/\\b(?:node|nodejs|node\\.js|npm|pnpm|yarn|bun|deno|python|chrome|chromium|firefox|safari|edge|macos|windows|ubuntu|debian|ios|android|typescript|react)\\b[^\\n]{0,24}?\\bv?\\d+\\.\\d+/i':
    'Chrome 141.0 broke it.',
};

/** A report carrying failure evidence and an environment, but no version. */
function reportWithVersion(version: string): string {
  return [
    '### Describe the bug', '', `Calling it twice breaks the second call. ${version}`, '',
    '### Steps', '', '```js', "const { run } = require('thing');", 'run();', '```', '',
    '### Output', '', '```text', 'TypeError: cannot read length of undefined', '```',
  ].join('\n');
}

test('the version list is the one being audited', () => {
  assert.deepEqual(literalsOf('VERSION_PATTERNS').slice().sort(), Object.keys(VERSION_SAMPLES).sort());
});

test('with no version anywhere, the gap this list suppresses is reported', () => {
  assert.ok(categories(reportWithVersion('')).includes('no-version'));
});

for (const [index, literal] of literalsOf('VERSION_PATTERNS').entries()) {
  test(`version pattern ${literal} is the one that decides its sample`, () => {
    const sample = VERSION_SAMPLES[literal];
    assert.ok(sample !== undefined, `no sample for ${literal}`);
    assert.ok(compile(literal).test(sample), `${literal} does not match its own sample`);

    for (const earlier of literalsOf('VERSION_PATTERNS').slice(0, index)) {
      assert.ok(
        !compile(earlier).test(sample),
        `${earlier} matches the sample for ${literal} and answers first`,
      );
    }

    assert.ok(!categories(reportWithVersion(sample)).includes('no-version'));
  });
}
