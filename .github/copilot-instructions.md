# GitHub Copilot – Repository Instructions (vscode-mssql)

These instructions apply to Copilot Chat and the Copilot coding agent when working in this repository.
**Goal:** keep changes consistent with our build, test, and review practices; and ensure the coding agent leverages the most relevant `AGENTS.md` for the area it is modifying.

---

## How to use AGENTS.md in this repo

- **Always consult the nearest `AGENTS.md` when planning or editing files.**
  - If you're changing files inside `extensions/<name>/…`, load and follow `extensions/<name>/AGENTS.md` for that subtree.
  - If multiple `AGENTS.md` files exist in parent/child folders, **the closest one to the file being changed wins**. Prefer the most specific guidance and avoid conflicting rules.
  - If no subtree file exists, fall back to the repository root `AGENTS.md` (if present).
    _Rationale: AGENTS.md hosts agent‑oriented steps (setup, build, test, review) and is designed to be read by coding agents._

### Known AGENTS.md locations (update this list as they are added)

- `extensions/mssql/AGENTS.md` – main extension agent guidance (build, test, package)
- `extensions/mssql/test/unit/AGENTS.md` – unit testing conventions (Sinon/Chai patterns)

> When preparing a plan or PR, explicitly state **which `AGENTS.md`** you followed (path) and **why** it was selected.

---

## Build & test (baseline expectations)

- Use the project's standard scripts and instructions from the relevant `AGENTS.md`. When absent, default to:
  - Install: `yarn install`
  - Build: `yarn build`
  - Test: `yarn test`
- **Working directory**: All build commands run from `extensions/mssql/` (not repo root).
- All changes must pass local builds/tests before creating a PR.
- Keep changes minimal and scoped. Prefer small, reviewable commits.

---

## Coding & review conventions

- Follow TypeScript strictness and repository lint/prettier rules.
- Add/adjust tests with code changes. Prefer unit tests close to the changed code.
- Maintain public API docs and update any affected READMEs or changelogs.
- In PR descriptions:
  1. Summarize the change and rationale
  2. Link the `AGENTS.md` used (e.g., `extensions/mssql/AGENTS.md`)
  3. Note any trade‑offs or follow‑ups

---

## How Copilot should select instructions at runtime

1. **If the current task touches files under `extensions/<name>/…`**
   - Load `extensions/<name>/AGENTS.md` and follow its setup/build/test/review steps.
   - Do **not** apply conflicting guidance from other areas.
2. **If multiple areas are involved**, segment the plan by area and apply each area's `AGENTS.md` to its changes. Call out boundaries in the plan.
3. **If no matching `AGENTS.md` exists**, proceed with repo‑wide guidance in this file and any path‑specific `.instructions.md` files under `.github/instructions/` that match the files being edited.

---

## Path‑specific overrides (optional, add as needed)

This repo may provide scoped rules via `.github/instructions/*.instructions.md` using `applyTo` globs (for example, front‑end vs back‑end differences). When present and matching the files in scope, combine them with the selected `AGENTS.md`.

---

## Safety & quality checklist before committing

- [ ] Ran install/build/test steps from the selected `AGENTS.md`
- [ ] Updated/added tests; all tests pass locally
- [ ] Followed repo style/linting; no eslint/prettier errors
- [ ] Documented changes and referenced the `AGENTS.md` path in the PR
