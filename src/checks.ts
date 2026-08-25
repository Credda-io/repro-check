/**
 * The checks.
 *
 * Every one of them answers the same shape of question: *is there anything in
 * this report that plays the role of X?* If there is, the check says nothing.
 * If there is not, it says so and points at where it looked.
 *
 * No check ever concludes that the report is sufficient. There is no code path
 * in this file that can produce that sentence, because nothing here knows what
 * a particular defect needs in order to be reproduced.
 */

import { excerpt, type CodeBlock } from './markdown.ts';
import { delimiterFaults, externalFiles, unresolvedNames } from './javascript.ts';
import type { Signals } from './signals.ts';
import type { Gap, GapCategory } from './types.ts';

/** Known template headings, which a bare `Label:` line is trusted for. */
const TEMPLATE_HEADING =
  /\b(?:reproduc|repro|steps|expected|actual|current|observed|environment|version|describe|description|context|screenshots?|additional|system|platform|logs?|configuration|config|behaviou?r|to reproduce|what happened)\b/i;

/**
 * Headings whose emptiness stops a reproduction.
 *
 * An empty "Additional context" costs a maintainer nothing; an empty "Steps to
 * reproduce" costs them the whole issue. Both are reported, and the difference
 * between them is the severity.
 */
const REPRODUCTION_HEADING =
  /\b(?:reproduc|repro|steps|expected|actual|current|observed|environment|version|describe the bug|description|behaviou?r|what happened|code|snippet|example|error|logs?)\b/i;

/** A run of code standing in for code the reporter did not paste. */
const ELISION = /^\s*(?:\/\/|#|\/\*)?\s*(?:\.{3}|…)\s*(?:rest|etc\.?|snip|more|omitted|truncated)?[^\n]{0,30}$/;

/** How many unresolved names in one block still counts as reading it correctly. */
const UNRESOLVED_LIMIT = 6;

type Check = (signals: Signals) => Gap[];

export const CHECKS: Readonly<Record<GapCategory, Check>> = {
  'unfilled-template': unfilledTemplate,
  'no-reproduction-steps': noReproductionSteps,
  'incomplete-snippet': incompleteSnippet,
  'unresolved-reference': unresolvedReference,
  'missing-fixture': missingFixture,
  'no-version': noVersion,
  'no-environment': noEnvironment,
  'expected-without-observed': expectedWithoutObserved,
  'observed-without-expected': observedWithoutExpected,
  'no-failure-evidence': noFailureEvidence,
};

function unfilledTemplate(signals: Signals): Gap[] {
  const gaps: Gap[] = [];
  const empty = new Set(signals.emptySections);
  for (const [at, section] of signals.report.sections.entries()) {
    if (!empty.has(section)) continue;
    if (section.kind === 'label' && !TEMPLATE_HEADING.test(section.heading)) continue;
    /*
     * A template's placeholder line is often itself heading-shaped, so one
     * unfilled section splits into two empty ones. Saying so twice would put a
     * number on this report that the report did not earn, so a run of adjacent
     * empty sections is reported once, at the heading the reporter saw.
     */
    const previous = signals.report.sections[at - 1];
    if (previous !== undefined && empty.has(previous)) continue;
    gaps.push({
      category: 'unfilled-template',
      severity: REPRODUCTION_HEADING.test(section.heading) ? 'blocking' : 'advisory',
      message: `The section "${section.heading}" is empty or still holds its template placeholder.`,
      evidence: section.body.length === 0 ? undefined : excerpt(section.body),
      line: section.headingLine,
    });
    if (gaps.length >= 4) break;
  }
  return gaps;
}

function noReproductionSteps(signals: Signals): Gap[] {
  const hasBlock = signals.report.blocks.some((block) => block.body.trim().length > 0);
  if (hasBlock || signals.commands.length > 0 || signals.reproLinks.length > 0) return [];
  if (signals.numberedSteps.length >= 2) return [];

  const onlyImages = signals.report.images.length > 0;
  return [{
    category: 'no-reproduction-steps',
    severity: 'blocking',
    message: onlyImages
      ? 'The report contains no code, command, numbered steps or link to a reproduction -- only prose and images, and an image cannot be run.'
      : 'The report contains no code, no command, no numbered steps and no link to a reproduction.',
  }];
}

function incompleteSnippet(signals: Signals): Gap[] {
  const gaps: Gap[] = [];
  for (const { block } of signals.programBlocks) {
    for (const fault of delimiterFaults(block.body).slice(0, 1)) {
      gaps.push({
        category: 'incomplete-snippet',
        severity: 'blocking',
        message: fault.kind === 'unclosed'
          ? `A snippet opens \`${fault.delimiter}\` and never closes it, so it is not a whole program.`
          : `A snippet closes \`${fault.delimiter}\` that was never opened, so what was pasted is a fragment.`,
        evidence: excerpt(lineIn(block, fault.line)),
        line: block.startLine + fault.line - 1,
      });
    }
    for (const [offset, line] of block.body.split('\n').entries()) {
      if (!ELISION.test(line) || line.trim().length === 0) continue;
      gaps.push({
        category: 'incomplete-snippet',
        severity: 'blocking',
        message: 'A snippet elides part of itself, so the code that runs is not the code in the report.',
        evidence: excerpt(line),
        line: block.startLine + offset,
      });
      break;
    }
  }
  return gaps.slice(0, 4);
}

function unresolvedReference(signals: Signals): Gap[] {
  const gaps: Gap[] = [];
  for (const { block, typescript } of signals.programBlocks) {
    // A fragment is already reported as incomplete, and reading one as a whole
    // program produces names that are missing only because the paste stopped.
    if (delimiterFaults(block.body).length > 0) continue;
    const unresolved = unresolvedNames(block.body, { typescript });
    // Past a handful, the likelier explanation is that this block is not the
    // kind of text this tool can read, so it says nothing about it at all.
    if (unresolved.length === 0 || unresolved.length > UNRESOLVED_LIMIT) continue;
    for (const name of unresolved.slice(0, 3)) {
      gaps.push({
        category: 'unresolved-reference',
        severity: 'blocking',
        message: `The snippet uses \`${name.name}\`, which nothing in it defines, imports or receives as an argument.`,
        evidence: excerpt(lineIn(block, name.line)),
        line: block.startLine + name.line - 1,
      });
    }
  }
  return gaps.slice(0, 6);
}

function missingFixture(signals: Signals): Gap[] {
  const gaps: Gap[] = [];
  for (const { block } of signals.programBlocks) {
    const elsewhere = signals.report.source.split(block.body).join('\n');
    for (const file of externalFiles(block.body)) {
      const base = file.path.split(/[\\/]/).pop() ?? file.path;
      if (base.length === 0) continue;
      if (elsewhere.includes(base)) continue;
      // A specifier with no extension is usually a directory or an alias, and
      // whether the report "includes" it is not a question this can settle.
      if (file.kind === 'import' && !/\.\w+$/.test(base)) continue;
      gaps.push({
        category: 'missing-fixture',
        severity: 'blocking',
        message: file.kind === 'read'
          ? `The snippet reads \`${file.path}\`, whose contents appear nowhere in the report.`
          : `The snippet imports \`${file.path}\`, whose contents appear nowhere in the report.`,
        evidence: excerpt(lineIn(block, file.line)),
        line: block.startLine + file.line - 1,
      });
    }
  }
  return gaps.slice(0, 4);
}

function noVersion(signals: Signals): Gap[] {
  if (signals.version !== null) return [];
  return [{
    category: 'no-version',
    severity: 'blocking',
    message: 'No version number is given anywhere -- not for the package, not for the runtime.',
  }];
}

function noEnvironment(signals: Signals): Gap[] {
  if (signals.environment !== null) return [];
  return [{
    category: 'no-environment',
    severity: 'advisory',
    message: 'No runtime, operating system or package manager is named.',
  }];
}

function expectedWithoutObserved(signals: Signals): Gap[] {
  if (signals.expected === null || signals.observed !== null) return [];
  return [{
    category: 'expected-without-observed',
    severity: 'blocking',
    message: 'The report says what should happen but never says what did happen, so there is nothing for a reproduction to match.',
    evidence: excerpt(signals.expected.text),
    line: signals.expected.line,
  }];
}

function observedWithoutExpected(signals: Signals): Gap[] {
  if (signals.observed === null || signals.expected !== null) return [];
  return [{
    category: 'observed-without-expected',
    severity: 'advisory',
    message: 'The report says what happened but never says what should have happened instead.',
    evidence: excerpt(signals.observed.text),
    line: signals.observed.line,
  }];
}

function noFailureEvidence(signals: Signals): Gap[] {
  if (signals.observed !== null || signals.errors !== null) return [];
  // Saying this and `expected-without-observed` is saying the same thing twice.
  if (signals.expected !== null) return [];
  return [{
    category: 'no-failure-evidence',
    severity: 'blocking',
    message: 'The report carries no error text, no stack trace and no observed value, so a reproduction has nothing to be checked against.',
  }];
}

function lineIn(block: CodeBlock, line: number): string {
  return block.body.split('\n')[line - 1] ?? '';
}
