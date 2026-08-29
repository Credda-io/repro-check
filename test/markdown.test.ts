import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excerpt, parseReport } from '../src/markdown.ts';

test('a fenced block keeps its language, its body and the line it starts on', () => {
  const report = parseReport('Intro line:\n\n```ts\nconst a = 1;\n```\n');
  assert.equal(report.blocks.length, 1);
  const block = report.blocks[0];
  assert.equal(block.lang, 'ts');
  assert.equal(block.body, 'const a = 1;');
  assert.equal(block.startLine, 4);
  assert.equal(block.fenced, true);
  assert.equal(block.intro, 'Intro line:');
});

test('an unclosed fence still yields the block it opened', () => {
  const report = parseReport('```js\nconst a = 1;\n');
  assert.equal(report.blocks.length, 1);
  assert.equal(report.blocks[0].body.trim(), 'const a = 1;');
});

test('a four-space indented run is a block, but an indented list item is not', () => {
  const indented = parseReport('Steps:\n\n    const a = 1;\n    a.toString();\n\nDone.\n');
  assert.equal(indented.blocks.length, 1);
  assert.equal(indented.blocks[0].fenced, false);

  const list = parseReport('Steps:\n\n    - install it\n    - run it\n');
  assert.equal(list.blocks.length, 0);
});

test('prose excludes code and blanks HTML comments while keeping line numbers', () => {
  const source = 'Line one\n\n```js\nsecretCode();\n```\n\n<!-- hidden -->\nLine two\n';
  const report = parseReport(source);
  assert.ok(!report.prose.includes('secretCode'));
  assert.ok(!report.prose.includes('hidden'));
  assert.ok(report.prose.includes('Line two'));
  assert.equal(report.prose.split('\n').length, source.split('\n').length);
  assert.deepEqual(report.htmlComments, ['hidden']);
});

test('headings come in three shapes and carry their bodies', () => {
  const report = parseReport('## Steps\n\ndo a thing\n\n**Expected**\n\nsomething\n\nActual:\n\nnothing\n');
  assert.deepEqual(report.sections.map((section) => [section.heading, section.kind]), [
    ['Steps', 'atx'],
    ['Expected', 'bold'],
    ['Actual', 'label'],
  ]);
  assert.equal(report.sections[0].body, 'do a thing');
  assert.equal(report.sections[0].headingLine, 1);
});

test('images are found in Markdown, HTML and bare-URL form', () => {
  const report = parseReport(
    '![shot](https://a.test/one.png)\n<img src="https://a.test/two.gif">\nhttps://a.test/three.jpeg\n',
  );
  assert.equal(report.images.length, 3);
});

test('CRLF input is normalised before anything reads it', () => {
  const report = parseReport('# Title\r\n\r\n```js\r\nconst a = 1;\r\n```\r\n');
  assert.equal(report.blocks[0].body, 'const a = 1;');
  assert.ok(!report.source.includes('\r'));
});

test('excerpt flattens and truncates', () => {
  assert.equal(excerpt('  a\n  b  '), 'a b');
  assert.equal(excerpt('x'.repeat(200)).length, 90);
});

test('backticked spans in prose are collected, with the line they were written on', () => {
  const report = parseReport("First line.\n\nCalling `pluralize('passerby')` returns the wrong plural.\n");
  assert.deepEqual(report.inlineCode, [{ text: "pluralize('passerby')", line: 3 }]);
});

test('a backticked span inside a code block is not an inline span', () => {
  const report = parseReport('```js\nconst a = `template`;\n```\n');
  assert.deepEqual(report.inlineCode, []);
});

test('a double-backtick span may contain a single backtick', () => {
  const report = parseReport('Use ``a `b` c`` here.\n');
  assert.deepEqual(report.inlineCode, [{ text: 'a `b` c', line: 1 }]);
});
