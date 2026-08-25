/**
 * repro-check -- a heuristic linter for bug reports.
 *
 * It answers one question, and only ever half of it: **does this report
 * obviously fail to contain something a reproduction would need?** When the
 * answer is no, the honest statement is "none of the things this tool looks for
 * are missing", which is what it says. It never says a report is reproducible,
 * because it does not know what this defect needs and cannot run anything.
 */

import { parseReport } from './markdown.ts';
import { readSignals } from './signals.ts';
import { CHECKS } from './checks.ts';
import { ALL_CATEGORIES, type CheckOptions, type CheckResult, type Gap, type GapCategory } from './types.ts';

export type { CodeBlock, ParsedReport, Section } from './markdown.ts';
export type { CheckOptions, CheckResult, Gap, GapCategory, Severity } from './types.ts';
export { ALL_CATEGORIES, CATEGORY_DESCRIPTIONS } from './types.ts';
export { parseReport } from './markdown.ts';
export { formatText, formatMarkdown, formatGitHub, DISCLAIMER } from './format.ts';

/**
 * Checks one issue body and reports the gaps found in it.
 *
 * Pure: no I/O, no network, no clock. The same text always produces the same
 * report, which is what makes the result usable as a CI gate.
 */
export function checkIssue(body: string, options: CheckOptions = {}): CheckResult {
  const skip = new Set<GapCategory>(options.skip ?? []);
  const signals = readSignals(parseReport(body));
  const checked: GapCategory[] = [];
  const gaps: Gap[] = [];

  for (const category of ALL_CATEGORIES) {
    if (skip.has(category)) continue;
    checked.push(category);
    gaps.push(...CHECKS[category](signals));
  }

  const blocking = gaps.filter((gap) => gap.severity === 'blocking').length;
  return {
    verdict: gaps.length === 0 ? 'no-gaps-found' : 'gaps-found',
    gaps,
    checked,
    counts: { blocking, advisory: gaps.length - blocking },
  };
}

/**
 * The process exit code for a result.
 *
 * Without `--strict` an advisory gap does not fail a build: it is a note for
 * the reporter, not a reason to refuse the issue.
 */
export function exitCodeFor(result: CheckResult, options: { strict?: boolean } = {}): number {
  if (options.strict === true) return result.gaps.length > 0 ? 1 : 0;
  return result.counts.blocking > 0 ? 1 : 0;
}
