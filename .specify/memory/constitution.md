<!--
Sync Impact Report
- Version change: 1.2.0 -> 1.3.0
- Modified principles:
  - VS Code Native UX & Accessibility
  - Security, Privacy & Trust
  - Performance & Reliability
  - Quality, Testability & Compatibility
- Added sections: none
- Removed sections: none
- Templates requiring updates:
  - .specify/templates/plan-template.md [updated]
  - .specify/templates/spec-template.md [updated]
  - .specify/templates/tasks-template.md [updated]
  - .specify/templates/checklist-template.md [unchanged]
  - .specify/templates/commands/*.md [missing] (no files found)
- Follow-up TODOs: none
-->
# vscode-mssql Extensions Constitution

## Core Principles

### VS Code Native UX & Accessibility
Build features that feel native to VS Code. Commands MUST be discoverable in the
Command Palette, UI MUST respect theming and keyboard navigation, and all
interactive flows MUST work without a mouse. Webviews are allowed only when a
native view cannot deliver the experience. Rationale: consistent, accessible UX
reduces user friction and support cost.

### Safety-First Database Operations
All potentially destructive actions (e.g., schema changes, deploy, drop, bulk
edit) MUST be explicit, previewable, and confirmable. The extension MUST NOT
auto-execute queries or mutate data without a clear user action, and MUST
provide cancellation for long-running operations. Rationale: users trust the
extension with production data and expect guardrails.

### Security, Privacy & Trust
Credentials and sensitive data MUST never be logged or surfaced in telemetry.
Secrets MUST be stored via VS Code secret storage or equivalent secure APIs.
Telemetry MUST be minimal, documented, and respect VS Code telemetry settings.
Query text and connection strings MUST NOT be emitted in telemetry; use
classification enums or counts instead. Errors should be sanitized to avoid
leaking connection details. Rationale: SQL workloads often contain sensitive
data and compliance obligations.

### Performance & Reliability
Extension activation MUST remain lightweight; heavy work MUST be lazy-loaded or
run after user intent. All I/O MUST be async and non-blocking, with timeouts and
retry strategies where appropriate. Features MUST degrade gracefully when
backend services (e.g., SQL Tools Service) are unavailable. Rationale: extension
host health and responsiveness are critical to editor stability.
Activation events MUST stay minimal; new activation events require explicit
justification and performance review.

### Quality, Testability & Compatibility
Every user-facing feature MUST have a test strategy (unit/integration/e2e as
appropriate). Cross-platform behavior (Windows/macOS/Linux) MUST be validated.
Public APIs and settings MUST remain backward compatible or provide clear
migration guidance. Rationale: the extension is a daily driver for developers
and regressions are costly.
Features MUST respect workspace trust and virtual workspace constraints; avoid
file system or network actions when VS Code marks the workspace as untrusted.

## Extension Architecture & Dependency Boundaries

- Each extension under `extensions/` MUST remain independently buildable and
  runnable; avoid implicit cross-imports between extensions.
- Shared code MUST live under `typings/` or a dedicated shared package rather
  than importing across extension folders.
- Dependency installation and builds MUST be executed within each extension
  folder unless a shared package explicitly requires root-level commands.
- Any new shared API surface MUST be documented and versioned to avoid hidden
  coupling.
- SQL Tools Service integration MUST support local debugging via the
  `MSSQL_SQLTOOLSSERVICE` override and manual replacement flows; extension code
  MUST NOT assume hard-coded paths or bundled binaries are always present.
- New extension dependencies or extension packs require explicit justification
  and compatibility review.

## Development Workflow & Quality Gates

- Plans and specs MUST include a Constitution Check section with explicit
  pass/fail gating for safety, security/privacy, performance, UX/accessibility,
  and compatibility.
- PRs MUST document affected extensions and validation steps (tests and/or
  manual scenarios).
- Feature branches created by speckit commands MUST use the
  `aasim/feat-###-short-name` prefix.
- For extension changes, `yarn build` and `yarn test` MUST pass in each affected
  extension folder. If a command is not applicable, document why in the PR.
- Changes that add new commands, settings, menus, or telemetry MUST update
  extension `package.json` contributions, `package.nls.json`, and README or
  relevant docs to keep user guidance current.
- Localization strings MUST be added for user-facing text in `package.nls.json`
  and kept in sync with UI changes.
- User-facing text changes MUST update `l10n` bundles and run localization
  extraction/generation workflows.
- Formatting and linting MUST follow repo tooling (eslint/prettier/lint-staged);
  do not hand-format around the toolchain.

## Governance

- The constitution supersedes other project practices. Any exception requires
  explicit documentation and approval in the PR.
- Amendments require: written proposal, rationale, impact summary, template
  updates, and version bump per semver rules.
- Compliance is reviewed in every feature plan and at PR time; violations MUST
  be recorded in the plan's Complexity Tracking table with justification.
- Guidance sources: `README.md`, extension-specific READMEs, and `/specs`.

**Version**: 1.3.0 | **Ratified**: 2026-01-23 | **Last Amended**: 2026-01-23
