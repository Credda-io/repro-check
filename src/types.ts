/** The vocabulary of the report this tool produces. */

/**
 * The kinds of missing element repro-check knows how to look for.
 *
 * This list is the tool's entire competence. It is deliberately short: a
 * category is only here if it can be decided from the text of the report by
 * rules that do not guess. Anything that needs judgement about *meaning* --
 * whether the steps are sufficient, whether the diagnosis is right, whether the
 * expected behaviour is the correct one -- is not here and is not coming.
 */
export type GapCategory =
  | 'unfilled-template'
  | 'no-reproduction-steps'
  | 'incomplete-snippet'
  | 'unresolved-reference'
  | 'missing-fixture'
  | 'no-version'
  | 'no-environment'
  | 'expected-without-observed'
  | 'observed-without-expected'
  | 'no-failure-evidence';

/**
 * How much a gap costs a maintainer.
 *
 * `blocking` means someone trying to reproduce the report has to go back and
 * ask. `advisory` means the report is weaker for it but a reproduction attempt
 * can still start.
 */
export type Severity = 'blocking' | 'advisory';

/** One specific thing the report does not contain. */
export interface Gap {
  readonly category: GapCategory;
  readonly severity: Severity;
  /** What is missing, in a sentence a maintainer could paste into a reply. */
  readonly message: string;
  /** The text this was decided from, when there is any. */
  readonly evidence?: string;
  /** 1-based line in the issue body, when the gap has a location. */
  readonly line?: number;
}

/**
 * The result of checking one report.
 *
 * `verdict` has two values and neither of them is "reproducible". The tool can
 * observe that something is absent; it cannot observe that everything needed is
 * present, because it does not know what this particular defect needs.
 */
export interface CheckResult {
  readonly verdict: 'gaps-found' | 'no-gaps-found';
  readonly gaps: readonly Gap[];
  /** Every category that was evaluated, whether or not it produced a gap. */
  readonly checked: readonly GapCategory[];
  readonly counts: { readonly blocking: number; readonly advisory: number };
}

export interface CheckOptions {
  /**
   * Categories to skip. Useful where a convention makes one of them noise --
   * a tracker for a hosted service has no version for the reporter to give.
   */
  readonly skip?: readonly GapCategory[];
}

/** Every category, in the order a report presents them. */
export const ALL_CATEGORIES: readonly GapCategory[] = [
  'unfilled-template',
  'no-reproduction-steps',
  'incomplete-snippet',
  'unresolved-reference',
  'missing-fixture',
  'no-version',
  'no-environment',
  'expected-without-observed',
  'observed-without-expected',
  'no-failure-evidence',
];

/** One line of prose per category, for `--explain` and the README. */
export const CATEGORY_DESCRIPTIONS: Readonly<Record<GapCategory, string>> = {
  'unfilled-template': 'A section of the issue template was left empty or still holds its placeholder text.',
  'no-reproduction-steps': 'The report contains no code, no command, no numbered steps and no link to a reproduction.',
  'incomplete-snippet': 'A code block stops in the middle: an unclosed bracket, or an elision standing in for code.',
  'unresolved-reference': 'A snippet uses a name that nothing in the same snippet defines, imports or receives.',
  'missing-fixture': 'A snippet reads or imports a file whose contents appear nowhere in the report.',
  'no-version': 'No version number is given for anything.',
  'no-environment': 'No runtime, operating system or package manager is named.',
  'expected-without-observed': 'The report says what should happen but never says what did happen.',
  'observed-without-expected': 'The report says what happened but never says what should have happened instead.',
  'no-failure-evidence': 'The report carries no error text, stack trace, or observed value -- nothing to match a reproduction against.',
};
