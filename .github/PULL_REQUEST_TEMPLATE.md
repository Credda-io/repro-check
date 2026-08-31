<!--
CONTRIBUTING.md has three rules that are not negotiable, and the checklist below
is those three plus the bar a new category has to clear.

The one that gets broken by accident, because it looks like a feature: IT CAN
REPORT A GAP, IT CAN NEVER REPORT SUFFICIENCY. When nothing is found the tool
says "no gaps found" and names how many categories it looked at. It does not say
the report is reproducible, because it cannot run the code, does not know the
project, and does not know what this particular defect needs. Do not add a
verdict that means "this is fine" — that is the one output that would make the
tool worse than useless, because somebody would trust it.

There are ten categories and there is meant to be pressure against an eleventh.
A linter that is wrong a quarter of the time is worse than a smaller one that is
right.
-->

**What is wrong today.** <!-- The behaviour, not the change. -->

**What this changes.**

**How you know it works.** <!-- Name the test and the fixture. -->

- [ ] `npm run check` passes, and `npm run build` still runs on Node 20.
- [ ] Nothing added means "this report is sufficient".
- [ ] `checkIssue` is still pure: no I/O, no clock, no network, no `eval`, snippets lexed and never executed.
- [ ] Zero runtime dependencies.
- [ ] Any new or changed regular expression has no quantifier applied to a group that can also match the empty string.
- [ ] A new category loses gaps rather than inventing them, says so if it is JavaScript-only, starts advisory unless a reproduction genuinely cannot be attempted without it, and ships a fixture in `test/fixtures/`.
- [ ] `node scripts/measure-corpus.mjs <cache>` was run for a new category, and the fire rate is in the description.
- [ ] Comments explain *why*, not *what*.
