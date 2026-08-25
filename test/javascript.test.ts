import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankLiterals, delimiterFaults, externalFiles, unresolvedNames } from '../src/javascript.ts';

const names = (code: string, typescript = false): string[] =>
  unresolvedNames(code, { typescript }).map((found) => found.name).sort();

test('literals, comments and regular expressions are blanked, keeping length', () => {
  const code = "const a = 'parseConfig'; // callThing()\nconst b = /divide/;";
  const blanked = blankLiterals(code);
  assert.equal(blanked.length, code.length);
  assert.equal(blanked.split('\n').length, code.split('\n').length);
  assert.ok(!blanked.includes('parseConfig'));
  assert.ok(!blanked.includes('callThing'));
  assert.ok(!blanked.includes('divide'));
  assert.ok(blanked.includes('const a ='));
});

test('a name that appears only inside a string is never unresolved', () => {
  assert.deepEqual(names("console.log('parseConfig(1)');"), []);
});

test('a called name the snippet never defines is reported', () => {
  const found = unresolvedNames("const out = parseConfig({ a: 1 });\nconsole.log(out);");
  assert.deepEqual(found.map((one) => one.name), ['parseConfig']);
  assert.equal(found[0].line, 1);
});

test('a dereferenced name the snippet never imports is reported', () => {
  assert.deepEqual(names("const schema = z.string();"), ['z']);
});

test('a bare identifier that is neither called nor dereferenced is not reported', () => {
  // Narrow on purpose: bare words turn up as JSX text and in pasted output.
  assert.deepEqual(names('if (mystery) { throw 1; }'), []);
});

test('names bound by every ordinary form are resolved', () => {
  const code = [
    "import { readFileSync } from 'node:fs';",
    "import mkdirp from 'mkdirp';",
    "const { parse: parseIt, stringify } = require('yaml');",
    'let counter = 0;',
    'function helper(alpha, beta = 2) { return alpha + beta + counter; }',
    'class Widget { render(child) { return child.name; } }',
    'const arrow = (x) => x.toString();',
    'try { helper(1); } catch (failure) { console.error(failure.message); }',
    'for (const entry of [1, 2]) console.log(entry.valueOf());',
    'readFileSync("a"); mkdirp.sync("b"); parseIt("c"); stringify({}); new Widget().render({}); arrow(1);',
  ].join('\n');
  assert.deepEqual(names(code), []);
});

test('runtime globals and runner-injected names are not reported', () => {
  const code = [
    'describe("x", () => {',
    '  it("works", async () => {',
    '    const response = await fetch("https://example.test");',
    '    expect(response.status).toBe(200);',
    '    process.stdout.write(Buffer.from("hi").toString());',
    '  });',
    '});',
  ].join('\n');
  assert.deepEqual(names(code), []);
});

test('a JSX attribute name is not read as a use', () => {
  assert.deepEqual(names('const el = <div onCommand={handle} data-id="1" />;\nfunction handle() {}'), []);
});

test('type annotations and mapped-type keys are not reported', () => {
  const code = [
    'interface Options { readonly retries: number; label?: string; }',
    'type Frozen<T> = { readonly [K in keyof T]: T[K] };',
    'type Either = Frozen<Options> | null;',
    'const value: Either = null;',
    'console.log(value);',
  ].join('\n');
  assert.deepEqual(names(code, true), []);
});

test('a shebang is not read as division followed by identifiers', () => {
  assert.deepEqual(names('#!/usr/bin/env node\nconsole.log(1);'), []);
});

test('an unclosed brace is reported with the line it was opened on', () => {
  const faults = delimiterFaults('function run() {\n  if (true) {\n    go();\n');
  assert.equal(faults.length, 2);
  assert.deepEqual(faults.map((fault) => fault.kind), ['unclosed', 'unclosed']);
  assert.deepEqual(faults.map((fault) => fault.line).sort(), [1, 2]);
});

test('a stray closing bracket is reported as unexpected', () => {
  const faults = delimiterFaults('run(1);\n});');
  assert.equal(faults[0].kind, 'unexpected');
  assert.equal(faults[0].delimiter, '}');
});

test('brackets inside strings, comments and regexes do not unbalance a snippet', () => {
  assert.deepEqual(delimiterFaults("const a = '{('; // )}\nconst b = /[)]/;"), []);
});

test('read paths and relative specifiers are collected', () => {
  const code = [
    "const { readFileSync } = require('node:fs');",
    "import helper from './helper.js';",
    "const text = readFileSync('fixtures/deploy.yaml', 'utf8');",
    "const pkg = require('lodash');",
  ].join('\n');
  const found = externalFiles(code);
  assert.deepEqual(
    found.map((one) => `${one.kind}:${one.path}`).sort(),
    ['import:./helper.js', 'read:fixtures/deploy.yaml'],
  );
});
