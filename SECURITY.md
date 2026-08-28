# Security

## Reporting a vulnerability

Use **GitHub's private vulnerability reporting** on this repository: the
Security tab, then "Report a vulnerability". That opens a private advisory
visible to the maintainers and to you, and nowhere else.

Please do not open a public issue for something exploitable, and please do not
wait for us to be ready before you tell us.

What helps, in rough order:

- what an attacker gets, stated first
- the smallest input that demonstrates it
- the version or commit you were on

If you would rather not use GitHub, [credda.io](https://credda.io) has the
contact details.

## What this package is, and therefore what its attack surface is

`repro-check` reads text somebody else wrote. Bug report bodies are public,
unauthenticated input, and the intended deployment is a CI job that runs on
every issue opened against a repository. That is worth being precise about.

- **`checkIssue` is pure.** No I/O, no clock, no network, no `eval`. The same
  text always gives the same answer. It lexes JavaScript snippets; it does not
  execute them, and it never will.
- **Zero runtime dependencies.**
- **It opens no socket itself.** The GitHub URL form shells out to the `gh` CLI,
  which is a tool you already trust and have already authenticated. The URL is
  passed as an argument vector with `shell: false`, so nothing in it can be read
  as a command, and a URL that does not match a GitHub issue is refused before
  `gh` is invoked rather than fetched and inspected afterwards.

The one thing to watch is the regular expressions in `src/signals.ts`,
`src/markdown.ts` and `src/javascript.ts`. They run against a report body an
attacker chooses, so a pattern that backtracks catastrophically would be a
denial of service on the CI job. If you find one, it is a vulnerability and we
want to know -- send the input that triggers it.

## Supported versions

The latest published minor. This package is pre-1.0; fixes go to `main` and to a
new release rather than to a branch.
