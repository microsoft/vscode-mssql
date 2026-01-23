<!--
Sync Impact Report

- Version change: 1.0.0 → 1.1.0
- Modified principles:
	- I. Security & Privacy by Default (NON-NEGOTIABLE) → expanded with repo-specific redaction/telemetry guidance
	- II. User Experience, Accessibility, and Localization → expanded with VS Code l10n expectations
	- III. Regression Protection (Tests or Justification) → expanded with repo test tooling and validation expectations
	- V. Diagnose-ability & Operational Clarity → expanded with bundle/build/package expectations
- Added sections: None (refined existing sections)
- Removed sections: None
- Templates requiring updates:
	- ✅ updated: .specify/templates/plan-template.md
	- ✅ updated: .specify/templates/tasks-template.md
	- ⚠ pending: .specify/templates/commands/*.md (directory not present in this workspace)
- Deferred TODOs:
	- TODO(RATIFICATION_DATE): Original adoption date unknown in this workspace; set when known.
-->

# vscode-mssql Constitution

## Core Principles

### I. Security & Privacy by Default (NON-NEGOTIABLE)
- All changes that handle credentials, tokens, connection strings, database names, server names, or query text MUST minimize exposure.
- Logs/telemetry MUST NOT record secrets and MUST avoid recording query text or full connection strings.
- New network, auth, or tooling surfaces MUST have threat/risk considerations documented in the spec or PR.
- Telemetry and diagnostics MUST be privacy-preserving (no sensitive customer content). If adding telemetry, use the existing telemetry patterns.
- Changes MUST respect VS Code untrusted/virtual workspaces support (do not assume full workspace trust).

Rationale: The extension touches production databases and user credentials; safety is foundational.

### II. User Experience, Accessibility, and Localization
- User-facing features MUST be discoverable (Command Palette, view contributions, or documented entry point) and have sensible defaults.
- UI and messages MUST follow VS Code UX patterns and be localizable (no hard-coded user-facing strings).
- Changes affecting editor/UI MUST consider keyboard navigation and accessibility.
- If a change adds/updates user-facing strings, it MUST flow through the repo's localization pipeline.

Rationale: This is a VS Code extension; UX quality is the product.

### III. Regression Protection (Tests or Justification)
- Behavior changes MUST be covered by automated tests when feasible.
- If tests are not feasible (e.g., platform limitation, upstream dependency, non-determinism), the PR MUST include an explicit justification and an alternative verification plan.
- Bug fixes MUST include a repro description and a verification step that would have failed before the fix.
- When changing the MSSQL extension, preferred validation is:
	- Build: run `yarn build` from `extensions/mssql/`
	- Lint: run `yarn lint src/ test/` from `extensions/mssql/` (do not lint build output)
	- Package: run `yarn package --online` from `extensions/mssql/`
	- Tests: run unit tests and/or Playwright smoke tests when feasible; otherwise document why they cannot be run locally and rely on CI.

Rationale: Extension regressions are costly and hard to triage without guardrails.

### IV. Backward Compatibility & Safe Defaults
- Changes MUST preserve user workflows and compatibility unless a breaking change is unavoidable.
- Breaking changes MUST be explicitly called out with migration notes.
- New settings MUST be additive and default to the safest, least surprising behavior.
- Changes that affect SQL Tools Service (STS) integration MUST consider version/platform compatibility and include a validation note (e.g., using locally built STS via `MSSQL_SQLTOOLSSERVICE` when applicable).

Rationale: Users rely on stable tooling in daily workflows.

### V. Diagnose-ability & Operational Clarity
- Errors surfaced to users MUST be actionable (what failed, why, and what to do next).
- Logging/diagnostics MUST be structured and targeted; do not spam logs.
- Performance-sensitive paths (query execution, Object Explorer, grid) MUST avoid unnecessary work and be evaluated for user impact.
- Changes MUST keep build/package health in mind (bundles, webviews, and packaging are part of the shipped product).

Rationale: Database tooling requires fast, explainable behavior to be trusted.

## Engineering Standards

- Primary language is TypeScript (Node.js); changes MUST follow existing ESLint/Prettier rules.
- User-facing strings MUST be localizable and routed through the existing localization approach.
- Prefer small, reviewable changes; avoid large refactors unless directly required by the feature.
- Avoid introducing new dependencies unless necessary; document rationale in the PR.
- Formatting changes MUST be intentional; avoid drive-by mass reformatting.

## Development Workflow & Quality Gates

- Work MUST start from a written spec (user scenarios + acceptance scenarios) for non-trivial changes.
- Implementation plans MUST include a Constitution Check section and call out any violations with justification.
- PRs MUST be reviewable: clear description, repro/verification steps, and links to specs/tasks when applicable.
- CI and required checks MUST be green before merge.
- If a PR changes runtime behavior in `extensions/mssql/`, it MUST include a short "Validation" section listing what was run (build/lint/tests/package) and any deviations.

## Governance
<!-- Example: Constitution supersedes all other practices; Amendments require documentation, approval, migration plan -->

- This constitution supersedes all other development guidance in this workspace.
- Any PR may propose an amendment; amendments MUST include:
	- Motivation and impact
	- Migration guidance (if behavior changes)
	- Version bump per the policy below
- Versioning policy for this constitution:
	- MAJOR: remove/redefine principles or governance in a backward-incompatible way
	- MINOR: add a new principle/section or materially expand constraints
	- PATCH: clarify wording without semantic change
- Compliance review expectation: reviewers MUST check constitutional compliance for impacted areas.

**Version**: 1.1.0 | **Ratified**: TODO(RATIFICATION_DATE): unknown | **Last Amended**: 2026-01-23
<!-- Example: Version: 2.1.1 | Ratified: 2025-06-13 | Last Amended: 2025-07-16 -->
