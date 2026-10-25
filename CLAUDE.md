# IOMP monorepo

Two products, two owners, one contract:

- `agent/` - IOMP Agent. Owner: @Rewer2022. Spec: `docs/specs/telemetry-agent-technical-specification.md` (Ukrainian).
- `platform/` - IOMP platform. Owner: @mutednew. Spec: `docs/specs/technical-specification.md` (Ukrainian).
- `contracts/` - the only interface between them. Shared.

Full rules: `docs/collaboration.md`. The short version:

1. Never commit to `main`. One task = one branch: `agent/<topic>`, `platform/<topic>`, `contract/<topic>` or `repo/<topic>`.
2. Only change files in your owner's zone (see `docs/collaboration.md`). The other zone is read-only for you.
3. Never import code between `agent/` and `platform/`. Shared types are generated from `contracts/` on each side.
4. If you need an API change, stop and propose a separate `contract/<topic>` PR that touches only `contracts/`. Never invent endpoints or fields that are not in `contracts/`.
5. Do not add files to the repo root. Dependency manifests and lock files live inside `agent/` or `platform/`.
6. `docs/specs/` is read-only. No secrets anywhere: the repository is public.
7. One PR touches one zone. Before opening a PR: `git fetch origin main && git rebase origin/main`.
8. Everything committed is in English (code, comments, docs, commit messages, PRs). Specs stay in Ukrainian.
9. The plan is GitHub issues. Work only on open issues assigned to your owner; start a session with `gh issue list --assignee @me --state open`. Every PR says `Closes #N`. Questions to the other side are issues assigned to them, not guesses in code.
