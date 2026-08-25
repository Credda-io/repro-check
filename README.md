# repro-check

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

## Use

```console
repro-check issue.md                 # a file
gh issue view 123 --json body -q .body | repro-check -   # stdin
repro-check https://github.com/owner/repo/issues/123     # via the gh CLI
repro-check --json issue.md          # machine-readable
repro-check --format markdown issue.md   # a comment body to post
repro-check --format github issue.md     # GitHub Actions annotations
repro-check --explain                # what every category means
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No gaps of the relevant severity were found |
| `1` | Gaps were found |
| `2` | The input could not be read |

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

The one worth pointing at is `unresolved-reference`:

```console
$ repro-check issue.md
issue.md: 1 gap found -- 1 blocking, 0 advisory

BLOCKING
  unresolved-reference (line 10)
    The snippet uses `parseConfig`, which nothing in it defines, imports
    or receives as an argument.
      const settings = parseConfig(load('./app.conf'));
```

That snippet looks complete. It cannot run.

## Limits, stated plainly

**It only reads JavaScript and TypeScript snippets.** `unresolved-reference`,
`incomplete-snippet` and `missing-fixture` apply to blocks tagged `js`, `ts`,
`jsx`, `tsx`, `mjs`, `cjs` or untagged blocks that clearly look like JavaScript.
A Python or Go snippet is counted as reproduction steps and otherwise left
alone. Every other category is language-neutral.

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

Run over 1,583 open issue bodies from 38 popular JavaScript repositories, it
found at least one gap in 92% of them, and no blocking gap in 20%. The most
common gaps were a missing environment (48% of reports), a missing version
(47%), and no failure evidence at all (35%). It found a snippet using a name
nothing defines in 19%, and a snippet reading a file the report never shows in
1%.

That is a measurement of this tool's rules against that corpus, not a claim
about how many of those issues are truly irreproducible. Some gaps it reports
are things the maintainer already knows; some reports it passes cannot be
reproduced for reasons no linter can see.

## Development

```console
npm install
npm run typecheck
npm test
npm run build
```

## Licence

Apache-2.0.

---

Built alongside [CodeReef](https://codereef.app), which works on the other half
of the problem: reproducing the reports that do contain enough.
