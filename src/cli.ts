#!/usr/bin/env node
/**
 * The command line.
 *
 * Reads an issue body from a file, from stdin, or -- if the `gh` CLI happens to
 * be installed and signed in -- from a GitHub issue URL. Nothing here reaches
 * the network itself: fetching is delegated to a tool the user already trusts,
 * or it does not happen.
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { checkIssue, exitCodeFor } from './index.ts';
import { formatGitHub, formatMarkdown, formatText } from './format.ts';
import { ALL_CATEGORIES, CATEGORY_DESCRIPTIONS, type GapCategory } from './types.ts';

const FORMATS = ['text', 'json', 'markdown', 'github'] as const;
type Format = (typeof FORMATS)[number];

interface Options {
  readonly inputs: string[];
  readonly format: Format;
  readonly strict: boolean;
  readonly skip: GapCategory[];
  readonly color: boolean;
  readonly help: boolean;
  readonly explain: boolean;
  readonly version: boolean;
}

const USAGE = `repro-check -- does this bug report contain enough to reproduce it?

Usage
  repro-check <file>...            check one or more issue bodies
  repro-check -                    read the body from stdin
  repro-check <github-issue-url>   fetch the body with the 'gh' CLI

Options
  --strict            treat advisory gaps as failures too
  --format <name>     text (default), json, markdown, github
  --json              shorthand for --format json
  --skip <a,b>        skip named gap categories
  --explain           list every gap category and exit
  --no-color          plain output
  -h, --help          this text
  -v, --version       print the version

Exit codes
  0  no gaps of the relevant severity were found
  1  gaps were found
  2  the input could not be read

repro-check is a heuristic linter. It reports gaps it found. It cannot tell you
a report is reproducible -- only that it found none of the things it looks for.`;

export function parseArgs(argv: readonly string[]): Options {
  const inputs: string[] = [];
  const skip: GapCategory[] = [];
  let format: Format = 'text';
  let strict = false;
  let color = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
  let help = false;
  let explain = false;
  let version = false;

  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    if (arg === '--strict') strict = true;
    else if (arg === '--json') format = 'json';
    else if (arg === '--no-color') color = false;
    else if (arg === '--color') color = true;
    else if (arg === '--explain') explain = true;
    else if (arg === '-h' || arg === '--help') help = true;
    else if (arg === '-v' || arg === '--version') version = true;
    else if (arg === '--format' || arg.startsWith('--format=')) {
      const value = arg.startsWith('--format=') ? arg.slice('--format='.length) : argv[++at];
      if (!FORMATS.includes(value as Format)) throw new UsageError(`unknown format '${value ?? ''}'`);
      format = value as Format;
    } else if (arg === '--skip' || arg.startsWith('--skip=')) {
      const value = arg.startsWith('--skip=') ? arg.slice('--skip='.length) : argv[++at];
      for (const name of (value ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
        if (!ALL_CATEGORIES.includes(name as GapCategory)) throw new UsageError(`unknown category '${name}'`);
        skip.push(name as GapCategory);
      }
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new UsageError(`unknown option '${arg}'`);
    } else {
      inputs.push(arg);
    }
  }
  return { inputs, format, strict, skip, color, help, explain, version };
}

class UsageError extends Error {}

/** Reads one input, whichever of the three shapes it is. */
export function readInput(input: string): { name: string; body: string } {
  if (input === '-') return { name: 'stdin', body: readFileSync(0, 'utf8') };
  if (/^https?:\/\//i.test(input)) return { name: input, body: fetchWithGh(input) };
  return { name: input, body: readFileSync(input, 'utf8') };
}

/**
 * Delegates the fetch to `gh`.
 *
 * The URL is passed as an argument, never through a shell, so nothing in it can
 * be read as a command. If `gh` is not installed the failure says so plainly
 * rather than pretending the issue was empty.
 */
function fetchWithGh(url: string): string {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+/.test(url)) {
    throw new UsageError(`'${url}' is not a GitHub issue URL; pass a file or '-' instead`);
  }
  for (const binary of ['gh', 'gh.exe', 'gh.cmd']) {
    const run = spawnSync(binary, ['issue', 'view', url, '--json', 'body', '--jq', '.body'], {
      encoding: 'utf8',
      shell: false,
    });
    if (run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ENOENT') continue;
    if (run.status !== 0) throw new UsageError(`gh could not read ${url}: ${(run.stderr ?? '').trim()}`);
    return run.stdout;
  }
  throw new UsageError("the 'gh' CLI is not installed, so a GitHub URL cannot be fetched; pass a file or '-' instead");
}

export function main(argv: readonly string[]): number {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`repro-check: ${(error as Error).message}\n\n${USAGE}\n`);
    return 2;
  }

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }
  if (options.explain) {
    for (const category of ALL_CATEGORIES) {
      process.stdout.write(`${category}\n  ${CATEGORY_DESCRIPTIONS[category]}\n`);
    }
    return 0;
  }

  const inputs = options.inputs.length > 0 ? options.inputs : ['-'];
  let worst = 0;
  const rendered: string[] = [];

  for (const input of inputs) {
    let read: { name: string; body: string };
    try {
      read = readInput(input);
    } catch (error) {
      process.stderr.write(`repro-check: ${(error as Error).message}\n`);
      return 2;
    }
    const result = checkIssue(read.body, { skip: options.skip });
    worst = Math.max(worst, exitCodeFor(result, { strict: options.strict }));
    if (options.format === 'json') {
      rendered.push(JSON.stringify({ input: read.name, ...result }, null, 2));
    } else if (options.format === 'markdown') {
      rendered.push(formatMarkdown(result, { name: read.name }));
    } else if (options.format === 'github') {
      rendered.push(formatGitHub(result, { name: input === '-' ? undefined : input }));
    } else {
      rendered.push(formatText(result, { name: read.name, color: options.color }));
    }
  }

  const output = rendered.filter((text) => text.length > 0).join('\n\n');
  if (output.length > 0) process.stdout.write(`${output}\n`);
  return worst;
}

function readVersion(): string {
  try {
    const url = new URL('../package.json', import.meta.url);
    const manifest = JSON.parse(readFileSync(url, 'utf8')) as { version?: string };
    return manifest.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
