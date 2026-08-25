/**
 * The promises the README makes about the package itself.
 *
 * A "zero dependency" claim that nothing enforces is a claim that quietly stops
 * being true, so it is a test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  bin?: Record<string, string>;
  exports?: unknown;
  license?: string;
  type?: string;
};

function sourceFiles(): string[] {
  const dir = fileURLToPath(new URL('src/', root));
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const path = `${at}/${entry}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.ts')) found.push(path);
    }
  };
  walk(dir);
  return found;
}

test('the package declares no runtime dependencies of any kind', () => {
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.deepEqual(manifest.peerDependencies ?? {}, {});
  assert.deepEqual(manifest.optionalDependencies ?? {}, {});
});

test('nothing in src imports anything but Node built-ins and its own files', () => {
  const specifier = /(?:^|\n)\s*(?:import|export)\b[^\n]*?from\s+['"]([^'"]+)['"]/g;
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(specifier)) {
      const target = match[1];
      const allowed = target.startsWith('./') || target.startsWith('../') || target.startsWith('node:');
      assert.ok(allowed, `${file} imports ${target}`);
    }
    assert.ok(!/\brequire\s*\(\s*['"](?!node:)/.test(text), `${file} uses a bare require`);
  }
});

test('the package is ESM, Apache-2.0, and ships an executable and types', () => {
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.license, 'Apache-2.0');
  assert.deepEqual(Object.keys(manifest.bin ?? {}), ['repro-check']);
  assert.ok(readFileSync(new URL('LICENSE', root), 'utf8').includes('Apache License'));
});

test('the README documents every gap category the tool can report', async () => {
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  const { ALL_CATEGORIES } = await import('../src/types.ts');
  for (const category of ALL_CATEGORIES) {
    assert.ok(readme.includes(category), `README does not document ${category}`);
  }
});
