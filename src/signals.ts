/**
 * The facts every check reads.
 *
 * A signal is always of the form "the report contains X, here". Nothing here
 * decides whether something is missing -- that is the checks' job -- and
 * nothing here interprets what the report means.
 */

import type { CodeBlock, ParsedReport, Section } from './markdown.ts';

/** A thing found in the report, with the text and line it was found at. */
export interface Evidence {
  readonly text: string;
  /** 1-based line in the issue body. */
  readonly line: number;
}

/** Fence tags that mean the block is a program in JavaScript or TypeScript. */
const JS_LANGUAGES = new Set([
  'js', 'jsx', 'javascript', 'mjs', 'cjs', 'node', 'ts', 'tsx', 'typescript', 'mts', 'cts',
]);

const TS_LANGUAGES = new Set(['ts', 'tsx', 'typescript', 'mts', 'cts']);

/** Fence tags that mean the block is a shell session or a script. */
const SHELL_LANGUAGES = new Set(['sh', 'bash', 'zsh', 'shell', 'console', 'terminal', 'powershell', 'ps1', 'bat', 'cmd']);

/** Fence tags for text a program produced, or configuration, rather than code. */
const PROSE_LANGUAGES = new Set([
  'text', 'txt', 'log', 'logs', 'output', 'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini',
  'diff', 'patch', 'html', 'xml', 'css', 'scss', 'less', 'md', 'markdown', 'csv', 'sql', 'http',
]);

/** A line the reporter pasted from a shell, prompt included. */
const COMMAND_LINE = /^\s*(?:[$>#]\s+)?((?:npm|pnpm|yarn|npx|bun|bunx|deno|node|python3?|pip3?|go|cargo|docker|make|git|curl|vitest|jest|mocha|tsc|next|vite|webpack)\b[^\n]*)$/gm;
const NUMBERED_STEP = /^\s*\d+[.)]\s+\S/gm;
/** A link that hands over a runnable reproduction rather than more prose. */
const REPRO_LINK = /\bhttps?:\/\/(?:(?:codesandbox\.io|stackblitz\.com|replit\.com|jsfiddle\.net|codepen\.io|gist\.github\.com)\/\S+|github\.com\/[\w.-]+\/[\w.-]+(?:\/tree\/\S*)?)(?=[\s)>,.]|$)/gi;

/**
 * Version evidence.
 *
 * A bare `1.5` in a program's output is not a version, so a two-part number
 * only counts when something next to it says it is one. A three-part number
 * counts on its own.
 */
const VERSION_PATTERNS: readonly RegExp[] = [
  /\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.+-]+)?\b/,
  /\b(?:version|versions|release|running|using|on|installed|upgraded?|since|affected)\b\W{0,12}v?\d+\.\d+/i,
  /\bv?\d+\.\d+\b\W{0,12}(?:and (?:above|later|newer)|or (?:later|newer|above)|onwards?)\b/i,
  /["'][^"'\n]{1,60}["']\s*:\s*["'][\^~>=<\s]*\d+\.\d+/,
  /[@=]\s*\^?~?v?\d+\.\d+/,
  /\b(?:node|nodejs|node\.js|npm|pnpm|yarn|bun|deno|python|chrome|chromium|firefox|safari|edge|macos|windows|ubuntu|debian|ios|android|typescript|react)\b[^\n]{0,24}?\bv?\d+\.\d+/i,
];

/** Runtimes, operating systems and package managers, named by the reporter. */
const ENVIRONMENT_PATTERN =
  /\b(?:node(?:\.?js)?|deno|bun|npm|pnpm|yarn|browser|chrome|chromium|firefox|safari|webkit|edge|opera|windows|win32|macos|mac ?os ?x|osx|darwin|linux|ubuntu|debian|alpine|fedora|centos|arch linux|wsl2?|docker|kubernetes|ios|android|electron|react[- ]native|jvm|python|ruby|php|rust|golang|\.net|vercel|netlify|cloudflare workers?|aws lambda|firebase)\b/i;

const EXPECTED_HEADING = /^(?:expected|desired|wanted)(?:\b.*\b(?:behaviou?r|result|output|outcome))?$|\bexpected\s+(?:behaviou?r|result|output|outcome)\b|^what (?:should|i expected)/i;
const OBSERVED_HEADING = /^(?:actual|current|observed)(?:\b.*\b(?:behaviou?r|result|output|outcome))?$|\b(?:actual|current|observed)\s+(?:behaviou?r|result|output|outcome)\b|^what (?:actually )?happens?$/i;

const EXPECTED_PROSE =
  /\b(?:i (?:would |had )?expect(?:ed)?\b|expected\s*(?:result|output|value|behaviou?r)?\s*[:=-]|should (?:be|return|throw|print|log|equal|contain|resolve|produce|have|not)\b|ought to\b|is supposed to\b)/i;
const OBSERVED_PROSE =
  /\b(?:instead\b|but (?:i |it |we )?(?:get|got|gets|returns?|returned|receive[ds]?|prints?|printed|throws?|threw)\b|actually (?:returns?|prints?|throws?|gives?|logs?)\b|actual\s*(?:result|output|value|behaviou?r)?\s*[:=-]|i (?:get|got)\b|it (?:returns?|prints?|logs?|throws?|gives?)\b|result(?:s|ing)? in\b|ends up\b|\b(?:is|was|are|were|becomes?|stays?|remains?)\s+(?:still\s+)?(?:null|undefined|NaN|empty|missing|wrong|incorrect|truncated|reversed|false|true|-?\d+)\b)/i;

/** `expr //=> value`, the compact way a reporter records what they saw. */
const ARROW_COMMENT = /\/\/\s*(?:=>|->|→)\s*\S/;
/** A REPL or shell prompt at the start of a line inside a code block. */
const PROMPT_LINE = /^\s*(?:>{1,3}|\.\.\.|\$|»|In \[\d+\]:)\s+\S/m;

const ERROR_PATTERNS: readonly RegExp[] = [
  // `TypeError: x`, `Error [ERR_REQUIRE_ESM]: y`, `Uncaught RangeError!`
  /^\s*(?:Uncaught\s+)?(?:[A-Z][A-Za-z]*)?(?:Error|Exception)\b(?:\s*\[[^\]\n]+\])?\s*[:!]/m,
  /^\s*Traceback \(most recent call last\)/m,
  /^\s{2,}at\s+\S+/m,
  /^\s*File "[^"]+", line \d+/m,
  /\bnpm ERR!/,
  /^\s*panic:/m,
  /\bSegmentation fault\b|\bcore dumped\b|\bSIG(?:SEGV|ABRT|KILL)\b/,
  /\bexit(?:ed with)? code [1-9]\d*\b/i,
  /\bFATAL ERROR\b/,
  /\b(?:ERR_[A-Z_]+|E[A-Z]{3,})\b/,
];

/** Text an issue template leaves behind when nobody fills the section in. */
const PLACEHOLDERS: readonly RegExp[] = [
  /^a clear and concise description/i,
  /^steps to reproduce the behaviou?r/i,
  /^(?:add )?any other context/i,
  /^if applicable,? add/i,
  /^describe the bug/i,
  /^(?:please )?(?:paste|put|write|add|insert)\b.{0,40}\bhere\b/i,
  /^e\.?g\.?[\s:]/i,
  /^(?:replace|fill) (?:this|in)\b/i,
  /^(?:todo|tbd|n\/?a|none|nil|\.{2,}|…|-{1,3}|\?+)$/i,
  // What a GitHub issue form writes into a field nobody filled in.
  /^no response$/i,
  /^your (?:answer|code|output|version)\b/i,
];

/** Everything the checks are allowed to know about one report. */
export interface Signals {
  readonly report: ParsedReport;
  /** Blocks that are plausibly a JavaScript or TypeScript program. */
  readonly programBlocks: readonly ProgramBlock[];
  readonly commands: readonly Evidence[];
  readonly numberedSteps: readonly Evidence[];
  readonly reproLinks: readonly Evidence[];
  /** Backticked spans that are a call the reporter could have run. */
  readonly inlineExpressions: readonly Evidence[];
  readonly version: Evidence | null;
  readonly environment: Evidence | null;
  readonly expected: Evidence | null;
  readonly observed: Evidence | null;
  readonly errors: Evidence | null;
  /** Sections whose body is empty once placeholder text is discounted. */
  readonly emptySections: readonly Section[];
}

/** A code block this tool is willing to read as a program. */
export interface ProgramBlock {
  readonly block: CodeBlock;
  readonly typescript: boolean;
}

export function readSignals(report: ParsedReport): Signals {
  return {
    report,
    programBlocks: programBlocks(report),
    commands: matchesIn(report, COMMAND_LINE, { includeCode: true }),
    numberedSteps: matchesIn(report, NUMBERED_STEP, { includeCode: false }),
    reproLinks: matchesIn(report, REPRO_LINK, { includeCode: false }),
    inlineExpressions: inlineExpressions(report),
    version: firstOf(report, VERSION_PATTERNS, { includeCode: true }),
    environment: firstOf(report, [ENVIRONMENT_PATTERN], { includeCode: 'annotated' }),
    expected: expectedEvidence(report),
    observed: observedEvidence(report),
    errors: firstOf(report, ERROR_PATTERNS, { includeCode: true }),
    emptySections: report.sections.filter((section) => isEffectivelyEmpty(section.body)),
  };
}

/**
 * A leading `new`, then an identifier or a member chain, then a call.
 *
 * Anchored at both ends: the whole span has to be the expression. `foo.js`,
 * `--flag` and `Array.prototype` do not match, and neither does a sentence
 * that merely contains a call.
 */
const CALL_SPAN = /^(?:new\s+)?[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*|\[[^\][]*\])*\s*\(/;
/** Something that makes the arguments a value rather than a parameter list. */
const ARGUMENT_LITERAL = /['"`\[{]|\b\d|\b(?:true|false|null|undefined|NaN)\b/;

/**
 * Backticked spans that are a call, and so are something to run.
 *
 * The bar is deliberately high, because backticks carry filenames, flags and
 * package names far more often than they carry code. A span qualifies when it
 * is *entirely* a call, its parentheses balance, and its outermost argument
 * list is either empty or contains a literal -- so `pluralize('passerby')` and
 * `moment()` count, and `pluralize(word, count)`, which is a signature copied
 * out of a README rather than a call somebody made, does not.
 */
function inlineExpressions(report: ParsedReport): Evidence[] {
  const found: Evidence[] = [];
  for (const span of report.inlineCode) {
    if (!CALL_SPAN.test(span.text)) continue;
    const args = outermostArguments(span.text);
    if (args === null) continue;
    if (args.trim().length > 0 && !ARGUMENT_LITERAL.test(args)) continue;
    found.push({ text: span.text, line: span.line });
    if (found.length >= 50) break;
  }
  return found;
}

/**
 * The text inside the first parenthesis group, or `null` when the span is not
 * a whole balanced expression. Quoted text is skipped so a bracket inside a
 * string cannot unbalance the count.
 */
function outermostArguments(text: string): string | null {
  let depth = 0;
  let opened = -1;
  let closed = -1;
  let quote: string | null = null;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (quote !== null) {
      if (char === '\\') at += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '(') { depth += 1; if (opened === -1) opened = at; continue; }
    if (char === ')') {
      depth -= 1;
      if (depth < 0) return null;
      if (depth === 0 && closed === -1) closed = at;
    }
  }
  if (quote !== null || depth !== 0 || opened === -1 || closed === -1) return null;
  const tail = text.slice(text.lastIndexOf(')') + 1).trim();
  if (tail.length > 0 && !/^[;,.]$/.test(tail)) return null;
  return text.slice(opened + 1, closed);
}

/**
 * Whether a section body says anything.
 *
 * HTML comments are template instructions, not content, and the placeholder
 * list is the text a template puts there for the reporter to overwrite.
 */
export function isEffectivelyEmpty(body: string): boolean {
  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (withoutComments.length === 0) return true;
  const flat = withoutComments.replace(/[*_`>#\-\s]+/g, ' ').trim();
  if (flat.length === 0) return true;
  return PLACEHOLDERS.some((pattern) => pattern.test(flat));
}

/**
 * Blocks worth reading as code.
 *
 * A tag settles it when there is one. An untagged block has to look like a
 * program and must not look like a transcript or a stack trace, because reading
 * a pasted error message as a program would turn every word in it into an
 * undefined name.
 */
function programBlocks(report: ParsedReport): ProgramBlock[] {
  const found: ProgramBlock[] = [];
  for (const block of report.blocks) {
    if (block.body.trim().length === 0) continue;
    if (block.lang !== null && !JS_LANGUAGES.has(block.lang)) continue;
    if (block.lang === null && !looksLikeJavaScript(block.body)) continue;
    if (PROMPT_LINE.test(block.body)) continue;
    if (ERROR_PATTERNS.slice(0, 5).some((pattern) => pattern.test(block.body))) continue;
    if (block.intro !== null && handsOverOutput(block.intro)) continue;
    found.push({ block, typescript: block.lang !== null && TS_LANGUAGES.has(block.lang) });
  }
  return found;
}

/**
 * Whether the sentence above a block hands it over as something that was
 * printed. A block introduced that way is a result, and results are not read as
 * programs.
 */
function handsOverOutput(intro: string): boolean {
  return /\b(?:outputs?|prints?|logs?|produces?|returns?|gives?|yields?|results? in|error|traceback|stack ?trace|output is|i see|i get)\s*:?\s*$/i.test(intro);
}

/**
 * Template syntaxes that borrow JavaScript's vocabulary without being it.
 *
 * A Svelte or Handlebars block has functions and arrows in it and would pass
 * the test below, and then every `{/if}` in it would be read as an unbalanced
 * brace. A tagged block is trusted; an untagged one carrying these markers is
 * not read as a program at all.
 */
const TEMPLATE_MARKUP = /\{[#/:@]|<%|\{\{|\bv-(?:if|for|bind)\b|^\s*<\/?[a-z][\w-]*[\s/>]/m;

function looksLikeJavaScript(body: string): boolean {
  if (TEMPLATE_MARKUP.test(body)) return false;
  const signals = [
    /\brequire\s*\(/, /\bimport\s+[\w{*]/, /\bexport\s+/, /\bconst\s+[\w{[]/, /\blet\s+[\w{[]/,
    /\bfunction\b/, /=>/, /\bconsole\.(?:log|error|warn)\s*\(/, /\bclass\s+\w+/,
  ];
  return signals.filter((pattern) => pattern.test(body)).length >= 2;
}

/**
 * Where a pattern is looked for.
 *
 * `includeCode: 'annotated'` means prose plus the blocks people paste
 * environment details into -- shell sessions, logs, configuration -- but not a
 * program, so an identifier in a snippet cannot stand in for the reporter
 * having named their runtime.
 */
interface SearchScope {
  readonly includeCode: boolean | 'annotated';
}

/**
 * The text a pattern is matched against, line-aligned with the issue body.
 *
 * Every scope produces a string with the same line count as the report, so a
 * match offset converts straight back to the line the reporter wrote it on.
 * Excluded regions are blanked rather than removed.
 */
function searchText(report: ParsedReport, scope: SearchScope): string {
  if (scope.includeCode === true) return report.source;
  const lines = report.prose.split('\n');
  if (scope.includeCode === 'annotated') {
    for (const block of report.blocks) {
      if (block.lang === null) continue;
      if (!SHELL_LANGUAGES.has(block.lang) && !PROSE_LANGUAGES.has(block.lang)) continue;
      for (const [offset, text] of block.body.split('\n').entries()) {
        const at = block.startLine - 1 + offset;
        if (at < lines.length) lines[at] = text;
      }
    }
  }
  return lines.join('\n');
}

function matchesIn(report: ParsedReport, pattern: RegExp, scope: SearchScope): Evidence[] {
  const haystack = searchText(report, scope);
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const found: Evidence[] = [];
  let match: RegExpExecArray | null;
  while ((match = global.exec(haystack)) !== null) {
    found.push({ text: (match[1] ?? match[0]).trim(), line: lineOf(haystack, match.index) });
    if (match[0].length === 0) global.lastIndex += 1;
    if (found.length >= 50) break;
  }
  return found;
}

function firstOf(report: ParsedReport, patterns: readonly RegExp[], scope: SearchScope): Evidence | null {
  const haystack = searchText(report, scope);
  for (const pattern of patterns) {
    const match = pattern.exec(haystack);
    if (match !== null) return { text: match[0].trim(), line: lineOf(haystack, match.index) };
  }
  return null;
}

function expectedEvidence(report: ParsedReport): Evidence | null {
  for (const section of report.sections) {
    if (EXPECTED_HEADING.test(section.heading) && !isEffectivelyEmpty(section.body)) {
      return { text: section.heading, line: section.headingLine };
    }
  }
  const prose = EXPECTED_PROSE.exec(report.prose);
  if (prose !== null) return { text: prose[0].trim(), line: lineOf(report.prose, prose.index) };
  for (const block of report.blocks) {
    const comment = /\/\/\s*(?:expected?|should be|want)\b[^\n]*/i.exec(block.body);
    if (comment !== null) return { text: comment[0].trim(), line: block.startLine };
  }
  return null;
}

function observedEvidence(report: ParsedReport): Evidence | null {
  for (const section of report.sections) {
    if (OBSERVED_HEADING.test(section.heading) && !isEffectivelyEmpty(section.body)) {
      return { text: section.heading, line: section.headingLine };
    }
  }
  const prose = OBSERVED_PROSE.exec(report.prose);
  if (prose !== null) return { text: prose[0].trim(), line: lineOf(report.prose, prose.index) };
  for (const block of report.blocks) {
    if (ARROW_COMMENT.test(block.body)) {
      return { text: 'a `//=>` annotation in a code block', line: block.startLine };
    }
    if (PROMPT_LINE.test(block.body) && block.body.split('\n').some((line, at, all) =>
      PROMPT_LINE.test(line) && (all[at + 1] ?? '').trim().length > 0 && !PROMPT_LINE.test(all[at + 1] ?? ''))) {
      return { text: 'a session transcript with printed output', line: block.startLine };
    }
  }
  for (const pattern of ERROR_PATTERNS) {
    const match = pattern.exec(report.source);
    if (match !== null) return { text: match[0].trim(), line: lineOf(report.source, match.index) };
  }
  return null;
}

export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let at = 0; at < offset && at < text.length; at += 1) {
    if (text[at] === '\n') line += 1;
  }
  return line;
}
