# Contributing

Issues and pull requests are welcome. This is a small package with a specific
shape, so it is worth knowing the shape before you spend an afternoon on it.

## Run it

```
npm install
npm run check    # typecheck, then the tests
```

The test runner is Node's own, over the TypeScript sources with no build step.
That needs a Node with type stripping **on by default -- 22.18 or newer, or 24
and up**. On Node 22.6 to 22.17 the suite fails to load every file with
`ERR_UNKNOWN_FILE_EXTENSION`; run it as

```
node --experimental-strip-types --test "test/**/*.test.ts"
```

and it passes. Either way that is your Node, not your change.

**`engines` deliberately still says `>=20.6.0`,** because that is the published
package's requirement -- consumers install compiled JavaScript from `dist/` and
have no TypeScript to strip. The newer Node is a requirement of working on this
repository, not of using it, and conflating the two would drop Node 20 users for
a reason that has nothing to do with them.

## The three rules that are not negotiable

1. **It can report a gap. It can never report sufficiency.** When nothing is
   found the tool says *no gaps found* and names how many categories it looked
   at. It does not say the report is reproducible, because it has no way to
   know: it cannot run the code, it does not know the project, and it does not
   know what this particular defect needs. Every output path carries the
   disclaimer. Do not add a verdict that means "this is fine".
2. **`checkIssue` is pure.** No I/O, no clock, no network, no `eval`. The same
   text always gives the same answer. Snippets are lexed, never executed.
3. **Zero runtime dependencies.**

## Adding a category

There are ten and there is meant to be pressure against an eleventh. A category
earns its place only if it can be decided **from the text by rules that do not
guess**. The README lists what is deliberately absent -- whether the steps are
sufficient, whether the expected behaviour is the correct behaviour, whether the
report duplicates another -- and those are absent because getting them right
needs judgement about meaning rather than rules about text.

A linter that is wrong a quarter of the time is worse than a smaller one that is
right. So, for a new category:

- **Which way does it fail?** Where a construct is ambiguous, this tool treats
  the name as *defined* and the report as *complete*. It loses gaps rather than
  inventing them. Match that.
- **Is it language-neutral, or JavaScript-only?** Three categories only apply to
  JS and TS snippets and say so. A new one that quietly assumes JavaScript needs
  to say so too.
- **Does it fire on the corpus?** `node scripts/measure-corpus.mjs <cache>` runs
  the rules over a directory of real issue bodies and prints how often each one
  fires. A category that fires on 90% of reports is noise; one that fires on
  none is not paying for itself.
- **Tests and a fixture.** `test/fixtures/` holds one Markdown body per shape,
  and `test/cli.test.ts` asserts the README's own worked example against the
  real output, so the README cannot drift.

New categories start **advisory** unless a reproduction genuinely cannot be
attempted without the thing.

## Regular expressions

They run against a report body an attacker chooses, in a CI job. No quantifier
applied to a group that can also match the empty string. A pattern that
backtracks catastrophically here is a denial of service, not a slow path -- see
[SECURITY.md](SECURITY.md).

## Style

Comments explain *why*, not *what*. Where a decision could reasonably have gone
the other way, the code says which way it went and what the alternative would
have cost. That is the house style across Credda's repositories and it is the
main thing reviewers will ask you for.

## Licence

Contributions are accepted under Apache-2.0, the same licence as the package.
