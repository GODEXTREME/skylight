# Paperclip GitHub Workflow

This repository can be updated safely from a Paperclip execution workspace with a
documentation-first pull request flow.

## Recommended steps

1. Start from `main` and create a dedicated feature branch for the issue.
2. Keep validation changes documentation-only unless the task explicitly requires code.
3. Verify the repo state locally before opening the pull request:
   - `git status --short`
   - `git branch -vv`
   - `git ls-remote origin refs/heads/main`
4. Open a pull request with:
   - a short summary of what changed
   - exact verification commands or checks performed
   - rollback notes describing how to revert the branch cleanly
5. Link the pull request back to the originating Paperclip issue for traceability.

## Operational notes

- This workflow keeps production untouched because all work lands in a reviewable branch.
- Documentation-only validation is reversible with a normal branch delete or PR close.
- If GitHub write access fails, stop before editing application code and resolve access first.
