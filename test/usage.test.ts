/**
 * Three lists of flags that have to be the same list.
 *
 * `parseArgs` decides what the command line accepts; `--help` tells a user at a
 * terminal; the README's "Use" block tells everybody else, and is the one with
 * the most readers and the least chance of being run. Nothing compared them, so
 * a flag could be added to one and not the others, or removed from the code and
 * left advertised in both -- and the README block is not executable, so no
 * amount of running the tool would notice.
 *
 * `--color` is how this was found: accepted by `parseArgs` since it was written,
 * documented in neither.
 *
 * Each set is read from its own source rather than written down here, so this
 * file cannot be the fourth copy that goes stale. The count assertion is not
 * decoration: three empty sets are equal, and an extraction regex that stops
 * matching is exactly how that would happen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli.ts';

const BIN = fileURLToPath(new URL('../src/bin.ts', import.meta.url));
const sorted = (names: Iterable<string>): string[] => [...new Set(names)].sort();

/** Every `--flag` the parser compares an argument against. */
function accepted(): string[] {
  const source = readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export function parseArgs'), source.indexOf('class UsageError'));
  return sorted([
    ...[...body.matchAll(/arg === '(--[a-z-]+)'/g)].map((m) => m[1] as string),
    ...[...body.matchAll(/arg\.startsWith\('(--[a-z-]+)='\)/g)].map((m) => m[1] as string),
  ]);
}

/** Every `--flag` the `--help` text documents, from the Options section. */
function documented(): string[] {
  const help = spawnSync(process.execPath, [...process.execArgv, BIN, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  const options = help.stdout.slice(help.stdout.indexOf('\nOptions\n'), help.stdout.indexOf('\nExit codes\n'));
  return sorted([...options.matchAll(/(--[a-z-]+)/g)].map((m) => m[1] as string));
}

/** Every `--flag` the README's "Use" block shows somebody typing. */
function advertised(): string[] {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const heading = readme.indexOf('\n## Use\n');
  assert.notEqual(heading, -1, 'the README no longer has a "Use" section');
  const open = readme.indexOf('```console', heading);
  const block = readme.slice(open, readme.indexOf('\n```', open));
  return sorted([...block.matchAll(/(--[a-z-]+)/g)].map((m) => m[1] as string));
}

test('the flags the parser accepts are the flags --help documents', () => {
  const flags = accepted();
  assert.ok(flags.length >= 8, `only found ${String(flags.length)} flags in parseArgs`);
  assert.deepEqual(documented(), flags);
});

test("the flags the parser accepts are the flags the README's Use block shows", () => {
  assert.deepEqual(advertised(), accepted());
});

test('every advertised flag is actually accepted, not merely spelled the same', () => {
  // A flag can be listed in all three places and still be rejected -- the
  // parser's fallthrough throws on anything starting with `-`. So each one is
  // put through the parser, with the argument it needs.
  const argumentFor: Readonly<Record<string, readonly string[]>> = {
    '--format': ['text'],
    '--skip': ['no-version'],
  };
  for (const flag of accepted()) {
    const argv = [flag, ...(argumentFor[flag] ?? []), 'issue.md'];
    assert.doesNotThrow(() => parseArgs(argv), `${flag} is advertised and rejected`);
    // And in its `--flag=value` spelling, where the parser has a second branch.
    if (flag in argumentFor) {
      assert.doesNotThrow(() => parseArgs([`${flag}=${argumentFor[flag]![0] as string}`, 'issue.md']));
    }
  }
});
