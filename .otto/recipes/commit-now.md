---
description: Commit the currently staged changes with a Conventional Commit message
agent: composer
includeInHistory: false
---

Create exactly one git commit for the currently staged changes using the Conventional Commits format.

Do not use prior session history. Rely only on the current repository state, the staged diff, and any recipe arguments provided by the user.

Steps:
1. Inspect `git status --short`.
2. If there are unresolved conflicts, report them and stop.
3. Inspect only the staged diff with `git diff --staged`.
4. If there are no staged changes, say there is nothing staged to commit and stop.
5. Infer the best Conventional Commit type from the staged changes:
   - `feat`
   - `fix`
   - `docs`
   - `style`
   - `refactor`
   - `perf`
   - `test`
   - `build`
   - `ci`
   - `chore`
   - `revert`
6. Use an optional scope when it is obvious and useful.
7. Write a concise imperative subject, lowercase unless using a proper noun or code token, with no trailing period.
8. Commit only the already staged changes with the inferred message.
9. Run `git status --short` after committing.
10. Summarize the commit hash, commit message, and any remaining unstaged/untracked changes.

Rules:
- Do not stage, unstage, or modify files.
- Do not run `git add`.
- Do not amend commits.
- Do not rewrite history.
- Do not run `git reset`, `git checkout`, `git rebase`, or destructive git commands.
- If commit hooks or tests fail, report the failure and do not bypass hooks unless explicitly requested.