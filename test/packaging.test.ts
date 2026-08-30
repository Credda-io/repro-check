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
  /* The subject first. This walked `src/` and asserted inside the loop, so a
   * renamed directory or a changed `statSync` guard would have produced an
   * empty list, run zero assertions, and passed -- an audit of nothing,
   * reported as an audit. */
  assert.ok(sourceFiles().length >= 5, `only ${sourceFiles().length} source files were found to audit`);

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

test('the README documents every gap category the tool can report, and no others', async () => {
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  const { ALL_CATEGORIES } = await import('../src/types.ts');

  for (const category of ALL_CATEGORIES) {
    assert.ok(readme.includes(category), `README does not document ${category}`);
  }

  /* The other direction, which is the one that rots. The table under "The gap
   * categories" opens with "Ten, and only ten", and a category removed from
   * the code leaves its row behind: the sentence stays true-looking, the row
   * documents something the tool can no longer report, and every assertion
   * above still passes. */
  const table = /## The gap categories\n([\s\S]*?)\n## /.exec(readme);
  assert.ok(table, 'README has no "## The gap categories" section to check');
  const documented = [...(table[1] ?? '').matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
  assert.ok(documented.length > 0, 'no category rows were extracted, so this test checked nothing');
  assert.deepEqual([...documented].sort(), [...ALL_CATEGORIES].sort());

  /* And the count in the prose is the count in the code. */
  assert.equal(ALL_CATEGORIES.length, 10, 'ALL_CATEGORIES no longer has ten members');
  assert.ok(
    /Ten, and only ten\./.test(readme),
    'ALL_CATEGORIES has ten members and the README no longer says so',
  );
});

/**
 * The measurement scripts still import names this package exports.
 *
 * `scripts/*.mjs` are the ONLY evidence for the figures in the README, and the
 * README tells a reader to run them rather than trust it. They are not in
 * `tsconfig.json`'s `include`, they are not matched by `npm test`, and no CI
 * job invokes them: rename `checkIssue` and all three break at run time with
 * nothing in this repository noticing, so the README's central honesty claim
 * becomes an instruction that errors out for whoever follows it.
 *
 * Running them needs a corpus that is not in this repository. What can be
 * checked without one is that every name they import from the package is a
 * name the package still exports -- which is the failure that would actually
 * happen.
 */
test('the measurement scripts import only names this package exports', async () => {
  const surface = await import('../src/index.ts');
  const exported = new Set(Object.keys(surface));

  const dir = new URL('scripts/', root);
  const scripts = readdirSync(dir).filter((name) => name.endsWith('.mjs'));
  assert.ok(scripts.length >= 3, `only ${scripts.length} scripts were found to check`);

  let checked = 0;
  for (const script of scripts) {
    const text = readFileSync(new URL(script, dir), 'utf8');
    for (const match of text.matchAll(
      /import\s*\{([^}]*)\}\s*from\s*['"](\.\.\/(?:dist|src)\/[^'"]+)['"]/g,
    )) {
      for (const name of (match[1] ?? '').split(',')) {
        const binding = name.trim().split(/\s+as\s+/)[0]?.trim();
        if (binding === undefined || binding === '') continue;
        checked += 1;
        assert.ok(
          exported.has(binding),
          `scripts/${script} imports { ${binding} } from ${match[2]}, which src/index.ts does not export`,
        );
      }
    }
  }
  assert.ok(checked > 0, 'no imports of this package were found in scripts/, so nothing was checked');
});
