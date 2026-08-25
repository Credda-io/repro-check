/**
 * Renderings of a result.
 *
 * Every one of them carries the disclaimer. It is not decoration: a reader who
 * sees "no gaps found" and takes it for "this reproduces" has been misled by
 * this tool, and the sentence is what stops that.
 */

import type { CheckResult, Gap, Severity } from './types.ts';

/** The one sentence that must survive every format. */
export const DISCLAIMER =
  'repro-check is a heuristic linter. It reports gaps it found; it cannot tell you a report is reproducible, only that it found none of the things it knows to look for.';

export interface FormatOptions {
  /** Where the body came from, for the header line. */
  readonly name?: string;
  readonly color?: boolean;
}

const COLORS: Record<string, string> = {
  reset: '\u001B[0m',
  dim: '\u001B[2m',
  bold: '\u001B[1m',
  red: '\u001B[31m',
  yellow: '\u001B[33m',
  green: '\u001B[32m',
};

export function formatText(result: CheckResult, options: FormatOptions = {}): string {
  const paint = (code: string, text: string): string =>
    options.color === true ? `${COLORS[code]}${text}${COLORS.reset}` : text;
  const name = options.name ?? 'issue';
  const out: string[] = [];

  if (result.verdict === 'no-gaps-found') {
    out.push(paint('green', `${name}: no gaps found`));
    out.push(`  Checked ${result.checked.length} categories and found none of them missing.`);
    out.push('');
    out.push(paint('dim', wrap(DISCLAIMER, 78, '  ')));
    return out.join('\n');
  }

  const { blocking, advisory } = result.counts;
  const summary = [
    `${result.gaps.length} gap${result.gaps.length === 1 ? '' : 's'} found`,
    `${blocking} blocking, ${advisory} advisory`,
  ].join(' -- ');
  out.push(paint(blocking > 0 ? 'red' : 'yellow', `${name}: ${summary}`));

  for (const severity of ['blocking', 'advisory'] as const) {
    const group = result.gaps.filter((gap) => gap.severity === severity);
    if (group.length === 0) continue;
    out.push('');
    out.push(paint('bold', severity.toUpperCase()));
    for (const gap of group) out.push(...renderGap(gap, paint));
  }

  out.push('');
  out.push(paint('dim', wrap(DISCLAIMER, 78, '  ')));
  return out.join('\n');
}

function renderGap(gap: Gap, paint: (code: string, text: string) => string): string[] {
  const location = gap.line === undefined ? '' : ` ${paint('dim', `(line ${gap.line})`)}`;
  const lines = [`  ${paint('dim', gap.category)}${location}`, wrap(gap.message, 74, '    ')];
  if (gap.evidence !== undefined) lines.push(paint('dim', `      ${gap.evidence}`));
  return lines;
}

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = indent;
  for (const word of words) {
    if (current.length > indent.length && current.length + word.length + 1 > width) {
      lines.push(current);
      current = indent;
    }
    current += current.length > indent.length ? ` ${word}` : word;
  }
  if (current.trim().length > 0) lines.push(current);
  return lines.join('\n');
}

/** A comment body a triage bot could post verbatim. */
export function formatMarkdown(result: CheckResult, options: FormatOptions = {}): string {
  const name = options.name ?? 'this report';
  const out: string[] = [];
  if (result.verdict === 'no-gaps-found') {
    out.push(`**repro-check** found no gaps in ${name}.`);
    out.push('');
    out.push(`_${DISCLAIMER}_`);
    return out.join('\n');
  }
  out.push(`**repro-check** found ${result.gaps.length} gap${result.gaps.length === 1 ? '' : 's'} in ${name}.`);
  out.push('');
  for (const severity of ['blocking', 'advisory'] as const) {
    const group = result.gaps.filter((gap) => gap.severity === severity);
    if (group.length === 0) continue;
    out.push(`### ${severity === 'blocking' ? 'Blocking' : 'Advisory'}`);
    out.push('');
    for (const gap of group) {
      const location = gap.line === undefined ? '' : ` _(line ${gap.line})_`;
      out.push(`- **${gap.category}**${location} — ${gap.message}`);
      if (gap.evidence !== undefined) out.push(`  \`${gap.evidence.replace(/`/g, "'")}\``);
    }
    out.push('');
  }
  out.push(`_${DISCLAIMER}_`);
  return out.join('\n');
}

/** GitHub Actions workflow commands, so gaps appear as annotations. */
export function formatGitHub(result: CheckResult, options: FormatOptions = {}): string {
  const file = options.name;
  return result.gaps
    .map((gap) => {
      const level: Record<Severity, string> = { blocking: 'error', advisory: 'warning' };
      const parts = [`title=repro-check: ${gap.category}`];
      if (file !== undefined) parts.unshift(`file=${file}`);
      if (gap.line !== undefined) parts.push(`line=${gap.line}`);
      return `::${level[gap.severity]} ${parts.join(',')}::${escapeCommand(gap.message)}`;
    })
    .join('\n');
}

function escapeCommand(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
