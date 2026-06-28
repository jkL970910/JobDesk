# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `jkL970910/JobDesk`.
Use the `gh` CLI for issue operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --comments`, including labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run
inside this clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

Do not pull external PRs into the normal `/triage` issue queue unless a user
explicitly asks to review or triage a PR. GitHub shares one number space across
issues and PRs, so if a bare `#42` is ambiguous, resolve it with `gh pr view 42`
and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
