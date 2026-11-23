# mend

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/chase-burns/mend/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/chase-burns/mend/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend is a command-line tool that applies edits an AI model wrote to a tree of text files. Models write edits in four formats — a unified diff (often with wrong line numbers), SEARCH/REPLACE blocks, the V4A patch format, and text-editor tool calls as JSON — and mend reads all four. It finds the lines each edit names at the first of three matching tiers (exact, trailing-whitespace-insensitive, fully whitespace-insensitive, with re-indentation of replaced lines at the loosest tier), writes every change or none, and prints what it changed or why it failed. It implements the competition's SPEC.md exactly: safe paths, per-format parse errors with patch line numbers, per-edit failures (no-match, ambiguous, missing, exists, unsafe), all-or-nothing writes, and a `--check` dry-run mode.

## Run it

```sh
node main.ts [--format=unified|search-replace|v4a|json] [--check] [--strict] [PATCH]
```

Run from the root of the tree to patch; PATCH is the patch file (standard input when absent or `-`). Node 22, standard library only.

---

<sub>Entered on [make.fun](https://make.fun/?ref=chase-burns&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
