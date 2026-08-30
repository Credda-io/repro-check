# repro-check

[![Apache-2.0](https://img.shields.io/badge/licence-Apache--2.0-informational)](LICENSE)
[![zero dependencies](https://img.shields.io/badge/dependencies-none-informational)](package.json)

**Does this bug report contain enough to reproduce it?**

Most bug reports cannot be reproduced from what they contain. The snippet calls
a function it never defines, the version is missing, the reporter says what
*should* have happened and never says what *did*. A maintainer finds this out
one issue at a time, by hand, days after the report was filed.

`repro-check` reads an issue body and tells you what is missing, before anyone
spends an afternoon on it.

```console
$ npx repro-check issue.md
issue.md: 4 gaps found -- 3 blocking, 1 advisory

BLOCKING
  no-reproduction-steps
    The report contains no code, no command, no numbered steps and no link
    to a reproduction.
  no-version
    No version number is given anywhere -- not for the package, not for
    the runtime.
  no-failure-evidence
    The report carries no error text, no stack trace and no observed
    value, so a reproduction has nothing to be checked against.

ADVISORY
  no-environment
    No runtime, operating system or package manager is named.

  repro-check is a heuristic linter. It reports gaps it found; it cannot tell
  you a report is reproducible, only that it found none of the things it knows
  to look for.
```

Zero dependencies. No account, no network, no model. It reads text and applies
rules.

## Why it is a package of its own

Because it belongs at the moment a report is filed, and nothing that lives at
that moment is allowed to be heavy. A tool that runs on every opened issue in a
public repository is running on unauthenticated input, from a GitHub Action, on
somebody else's minutes -- so it has no dependencies to audit, opens no socket,
calls no model, and finishes in milliseconds. Those constraints are the product;
they are not compatible with being a feature of something larger.

It is also the half of the problem that can be solved by rules. Deciding whether
a report is *sufficient* takes judgement about meaning. Deciding whether it
contains a version number, closes its code blocks, and defines the function its
snippet calls does not, and a maintainer should not be finding those out by hand
three days later.

## What it has to do with Credda

[Credda](https://credda.io) takes a bug report or security vulnerability a
customer has labelled, reproduces the failure, diagnoses the cause, writes the
patch, proves it with a test that fails before and passes after, and hands back
a diff. It runs in your own CI. Whether that diff becomes a
pull request depends on which mechanism delivered it, and the two answer
differently: the **GitHub App** path opens one with no flag and no switch, for a
run that reaches `READY_FOR_REVIEW` with a proven verdict; the **GitHub Action**
opens none unless you set its `open-pull-request` input, which defaults to
`false`, **and** add `contents: write` and `pull-requests: write` to your own
workflow's `permissions:` block, which a default install does not grant. Turning
the input on without both scopes fails at that step rather than opening
anything. How often a run reaches a proven fix at all has not been measured. It
proposes and never merges.

`repro-check` works on the report that arrives before any of that can start. A
report with no version, no observed value and a snippet that calls an undefined
function cannot be reproduced by a person or by anything else, and the honest
response is to say what is missing rather than to spend a sandbox finding out.
This package is that response, extracted so it is useful on its own to
maintainers who will never run Credda at all.

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerabilities:
[SECURITY.md](SECURITY.md), privately -- it reads public, attacker-chosen text
in a CI job, and that is worth being precise about.

## The one thing to understand first

**`repro-check` can tell you a report is missing something. It can never tell
you a report is sufficient.**

Those are not the same statement and the tool never conflates them. When it
finds nothing, it says *no gaps found* and names how many categories it looked
at — not *this is reproducible*, which it has no way to know. It cannot run the
code, it does not know your project, and it does not know what this particular
defect needs.

Read a clean result as "none of the ten obvious things are wrong", and nothing
more.

## Install

```console
npm install --save-dev repro-check   # or: npx repro-check <file>
```

Node 20.6 or newer.

> **Not on npm yet — checked 2026-08-28.** `https://registry.npmjs.org/repro-check`
> returns 404, so neither command above resolves today, and the `npx` invocations
> shown elsewhere in this README are illustrations of the finished interface
> rather than commands you can run. Until `0.1.0` is published, use it from a
> checkout: `npm install && npm run build && node dist/bin.js issue.md`.
>
> Running the test suite from source needs Node **22.18 or newer** (or 24) — it
> runs Node's own test runner straight over the TypeScript with no build step,
> which needs type stripping on by default. The `20.6` above is what the
> *published* package needs, since that ships compiled JavaScript.

## Use

```console
repro-check issue.md                 # a file
repro-check one.md two.md three.md   # several; the worst exit code wins
gh issue view 123 --json body -q .body | repro-check -   # stdin
repro-check https://github.com/owner/repo/issues/123     # via the gh CLI
repro-check --json issue.md          # machine-readable
repro-check --format markdown issue.md   # a comment body to post
repro-check --format github issue.md     # GitHub Actions annotations
repro-check --strict issue.md        # advisory gaps fail too
repro-check --skip no-version,no-environment issue.md    # drop categories
repro-check --no-color issue.md      # no ANSI escapes
repro-check --color issue.md         # colour even when piped
repro-check --explain                # what every category means
repro-check --version                # the version, and nothing else
repro-check --help                   # this list, from the tool itself
```

The GitHub URL form shells out to the `gh` CLI. `repro-check` never opens a
socket itself, and a URL that is not a GitHub issue is refused rather than
fetched.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No gaps of the relevant severity were found |
| `1` | Gaps were found |
| `2` | The input was empty or could not be read, or the command line was wrong |

Exit 2 covers both halves: a file that does not exist, a file that is empty, a
URL that is not a GitHub issue, `gh` not being installed, and also an unknown
flag, an unknown `--format` or an unknown `--skip` category.

An **empty** input exits 2 rather than reporting gaps. Every gap this tool looks
for is the absence of something, so a zero-byte document satisfies all of them
at once and used to render as the worst report ever filed — which meant a
mistyped path or a `gh` call that returned nothing came back looking like a
verdict about somebody's issue. Running `repro-check` with no arguments at a
terminal now prints the usage instead of waiting on stdin for input nobody is
going to type; piping still works, with or without the explicit `-`. An unrecognised category is an error
rather than a silent no-op, because a typo in a `--skip` list would otherwise
quietly turn a check back on.

With several inputs the process exits on the worst result any one of them
produced.

By default only **blocking** gaps fail the run. `--strict` makes advisory gaps
fail too. `--skip <a,b>` turns off categories that are noise for your project —
a hosted service has no version for a reporter to give.

### In CI

```yaml
- name: Check the issue body
  run: |
    gh issue view "$NUMBER" --json body -q .body > issue.md
    npx repro-check --format github issue.md
  env:
    NUMBER: ${{ github.event.issue.number }}
    GH_TOKEN: ${{ github.token }}
```

Each gap becomes an annotation; a blocking gap fails the step.

### As a library

```js
import { checkIssue, exitCodeFor } from 'repro-check';

const result = checkIssue(body);
// { verdict: 'gaps-found' | 'no-gaps-found', gaps: [...], checked: [...], counts: {...} }
for (const gap of result.gaps) {
  console.log(gap.category, gap.severity, gap.message, gap.line);
}
process.exitCode = exitCodeFor(result, { strict: true });
```

`checkIssue` is pure: no I/O, no clock, no network. The same text always gives
the same answer. Types ship with the package.

## The gap categories

Ten, and only ten. A category is here because it can be decided from the text by
rules that do not guess.

| Category | Severity | What it means |
| --- | --- | --- |
| `unfilled-template` | blocking\* | A section of the issue template is empty or still holds its placeholder text. |
| `no-reproduction-steps` | blocking | No code, no command, no numbered steps, no link to a reproduction. |
| `incomplete-snippet` | blocking | A code block stops mid-way: an unclosed bracket, or `// ...` standing in for code. |
| `unresolved-reference` | blocking | A snippet calls or dereferences a name that nothing in it defines, imports or receives. |
| `missing-fixture` | blocking | A snippet reads or imports a file whose contents appear nowhere in the report. |
| `no-version` | blocking | No version number anywhere — not the package, not the runtime. |
| `no-environment` | advisory | No runtime, operating system or package manager is named. |
| `expected-without-observed` | blocking | The report says what should happen and never says what did. |
| `observed-without-expected` | advisory | The report says what happened and never says what should have. |
| `no-failure-evidence` | blocking | No error text, no stack trace, no observed value — nothing to check a reproduction against. |

\* `unfilled-template` is blocking when the empty section is one a reproduction
needs — steps, version, environment, expected, actual — and advisory otherwise.
An empty "Additional context" is worth mentioning; it is not worth failing a
build over.

The one worth pointing at is `unresolved-reference`. Given this whole issue
body, which is [`test/fixtures/readme-example.md`](test/fixtures/readme-example.md):

````markdown
**Expected:** `settings.locale` is `en-GB`, the value in the config file.

**Actual:** it is `undefined`. repro-check 0.1.0, Node 20.11, Ubuntu 22.04.

```js
import { readFileSync } from 'node:fs';
const load = (p) => readFileSync(p, 'utf8');
const settings = parseConfig(load('./app.conf'));
console.log(settings.locale);
```
````

```console
$ repro-check test/fixtures/readme-example.md
test/fixtures/readme-example.md: 1 gap found -- 1 blocking, 0 advisory

BLOCKING
  unresolved-reference (line 8)
    The snippet uses `parseConfig`, which nothing in it defines, imports
    or receives as an argument.
      const settings = parseConfig(load('./app.conf'));

  repro-check is a heuristic linter. It reports gaps it found; it cannot tell
  you a report is reproducible, only that it found none of the things it knows
  to look for.
```

That block is asserted against the real output in
[`test/cli.test.ts`](test/cli.test.ts), so this README cannot drift away from
what the code does.

The snippet looks complete. It cannot run. Every other gap the report could
have had, it does not: it names a version, a runtime and an operating system,
it says what it expected and what it got, and the code block closes. That is
what one remaining gap looks like.

## Limits, stated plainly

**It only reads JavaScript and TypeScript snippets.** `unresolved-reference`,
`incomplete-snippet` and `missing-fixture` apply to blocks tagged `js`, `ts`,
`jsx`, `tsx`, `mjs`, `cjs` or untagged blocks that clearly look like JavaScript.
A Python or Go snippet is counted as reproduction steps and otherwise left
alone. Every other category is language-neutral.

**Outside a code block, it only reads calls.** A reporter who never opens a
fence has still handed over something to run when the sentence contains
`` `pluralize('passerby')` ``, and `no-reproduction-steps` does not fire on
that. The bar is deliberately high: the whole backticked span has to be a call,
its parentheses have to balance, and its arguments have to be empty or contain a
literal. `` `index.js` ``, `` `--no-color` `` and `` `pluralize(word, count)` ``
— a signature copied out of a README rather than a call anybody made — are not
code. On the 616-report corpus below this removed 62 reports from
`no-reproduction-steps`, each one a report the tool had said contained no code
while quoting the code it contained.

**It is a lexer, not a parser.** It has no model of scope. Where a construct is
ambiguous it treats the name as *defined*, which loses gaps rather than
inventing them. `unresolved-reference` only fires on a name that is called
(`parseConfig(...)`) or reached into (`z.string()`), because a bare identifier
can just as easily be JSX body text or a word in somebody's pasted build output.

**A pasted fragment of your own source will be flagged.** If a reporter pastes
twenty lines out of your library to point at a line, those lines genuinely do
not define what they use, and `repro-check` says so. That is accurate but not
always useful; `--skip unresolved-reference` if your tracker is mostly that.

**Things it deliberately does not do**, because getting them right needs
judgement about meaning rather than rules about text:

- whether the steps are *sufficient*, or in the right order
- whether the expected behaviour is the correct behaviour
- whether the reporter's diagnosis matches the symptom they describe
- whether the report duplicates another one
- whether the version given is the version actually affected
- whether prose that *looks* like a description says anything

A linter that is wrong a quarter of the time is worse than a smaller one that is
right, so those are absent rather than approximated.

## How it behaves on real reports

Run over **1,631 open issue bodies from 40 JavaScript repositories**, it found
at least one gap in 92% of them, and no blocking gap in 19%. The most common
gaps were a missing environment (49% of reports), a missing version (48%), no
failure evidence at all (36%), an unfilled issue template (28%) and no
reproduction steps (26%). It found a snippet using a name nothing defines in
19%, and a snippet reading a file the report never shows in 1%.

**Re-derive it rather than trusting it.** The script that produced those figures
ships in this repository, and it takes a directory of GitHub issue-API pages:

```console
node scripts/measure-corpus.mjs <path-to-cache-dir>
```

The harvest these numbers came from is not public, so build your own -- the
script's docblock has the one `gh api` call that writes a page, and any corpus in
that shape works. Pull requests and empty bodies are dropped; every remaining
body is one reporter's own text, unedited. A category is counted once per report
rather than once per gap, so a report naming three unresolved references counts
once. These figures came out of that command against that corpus, and they move
when the corpus does.

That is a measurement of this tool's rules against that corpus, not a claim
about how many of those issues are truly irreproducible. Some gaps it reports
are things the maintainer already knows; some reports it passes cannot be
reproduced for reasons no linter can see.

## Does a clean result predict a reproducible report? No.

That is the first paragraph of this README stated as a warning rather than a
caveat, and it has now been measured rather than asserted.

**The corpus.** 1,238 bug reports from 147 JavaScript packages, merged from four
independent harvest runs over three repository pools and two claim parsers. Each
report is labelled by *execution*: a candidate expression was taken from it, run
at the commit the issue was filed against and again at the maintainer's fix
commit, and labelled **runnable** only when the two runs behaved differently.
165 cleared that bar. Nothing about the label is a judgement — it is the outcome
of running code at two commits, and it is the closest thing to ground truth this
question has.

**Not every rejection is a label.** 401 of those reports were rejected because
the harness never got far enough to learn anything about them: the fix commit
had no first parent to pin against, the package would not load at the pin, or
the checkout would not provision. A report whose repository loses its pin is not
thereby a worse report, so counting those as "not runnable" pads the negative
class with noise and *flatters* any tool scored against it. The headline below
is the **executed-only** set — 833 reports where the expression actually ran at
both commits, base rate 19.7%. `scripts/collect-labels.mjs --executed-only`
emits exactly that set; without the flag it emits all 1,238, and both are
reported here.

Scored against those labels, with "no blocking gap" read as the tool letting a
report through:

| executed-only (833) | labelled runnable | labelled not |
| --- | --- | --- |
| **let through** | 12 | 82 |
| **blocked** | 152 | 587 |

Base rate 19.7%. Accuracy 71.9%, but **precision 12.8%** — a report this tool
lets through is *less* likely to be runnable than one picked at random — and
**recall 7.3%**. On all 1,238 rows the same shape is worse, not better: base
rate 13.3%, precision 7.5%, recall 7.3%.

Every category fires at or near the base rate: `no-environment` 21.0%,
`no-version` 20.6%, `unresolved-reference` 19.1%, `no-failure-evidence` 22.6%,
`expected-without-observed` 18.8%. A rule that fires at the base rate carries no
information about the thing it is being asked to predict. Two lean the *wrong*
way — `no-reproduction-steps` fires on reports that are 29.4% runnable and
`incomplete-snippet` on 30.8%, both above base rate on small counts, so the
reports these rules flag are if anything slightly *more* likely to be runnable
than the ones they clear.

**What that means.** It is not a defect being reported here; it is the boundary
the tool has claimed from the beginning, with a number on it. `repro-check`
finds absences. Whether a defect can be reproduced turns on whether the report
names a call and a value, and that is a different question that this tool has
never answered and cannot. **Do not gate merges, close issues, or rank triage
queues on a clean result.** Post the gaps to the reporter and stop there.

**Caveat that cuts the other way.** Most of these reports were reached
*because* no regex could read a claim out of them — reports with a plain fenced
snippet and an explicit expected value were filtered out before the largest of
the four runs existed. So the population is unusually gap-heavy, and the matrix
describes it, not every tracker. The finding that survives the selection is the
per-category one: within this population, no rule separates the runnable reports
from the rest. Two further limits: the four runs share repositories, so a
package with many issues weighs more than one with few; and 5 reports were
skipped because no cached text for them exists.

**What the last fix moved.** Scoring the same 616-row run before and after the
inline-code-span fix (`b10ffeb`) — the defect this measurement found, where a
report quoting `` `f(x)` `` inline was told it had no code — `no-reproduction-steps`
went from firing on 176 reports to 114, and **precision did not move**: 14.8%
either way, recall 7.0% to 7.9%, accuracy 75.3% to 74.5%. 62 reports stopped
being told something false about themselves, which is worth doing on its own
terms, and it bought no predictive power.

**Re-derive it.** The scorer and the label collector both ship here:

```console
npm run build
node scripts/collect-labels.mjs <bench/harvested> --executed-only > labels.json
node scripts/measure-agreement.mjs labels.json --cache <bench/harvested/.cache>
```

Each script's docblock states what it reads and what it refuses to treat as a
label. The corpus these figures came from is not public; the scripts are, and so
is the shape.

## Development

```console
npm install
npm run typecheck
npm test
npm run build
```

`npm test` is Node's own runner over the TypeScript sources with no build step,
so it needs a Node with type stripping on by default -- **22.18 or newer, or 24
and up**. On Node 22.6 to 22.17 every file fails to load with
`ERR_UNKNOWN_FILE_EXTENSION`; run
`node --experimental-strip-types --test "test/**/*.test.ts"` instead.
`engines` deliberately still says `>=20.6.0`, because that is what the
*published* package needs: consumers install compiled JavaScript and have no
TypeScript to strip.

[CONTRIBUTING.md](CONTRIBUTING.md) has the three rules that are not negotiable
and what a proposed eleventh category has to clear.

## Licence

Apache-2.0.
