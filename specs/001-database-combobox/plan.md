# Implementation Plan: Searchable Database Combobox

**Branch**: `aasim-khan/feat/001-database-combobox` | **Date**: 2026-01-29 | **Spec**: `specs/001-database-combobox/spec.md`
**Input**: Feature specification from `/specs/001-database-combobox/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add a searchable database combobox to the connection dialog that loads database options on focus
only after required fields are populated (SQL: server+user+password, Entra: server+account,
Windows: server). The combobox supports search and freeform entry, always includes the literal
`<default>` option, keeps the database value when auth/server changes, and suppresses load errors
by showing an empty list while still allowing manual entry. Options are retrieved via a temporary
connection and SQL Tools Service listDatabases request.

## Technical Context

**Language/Version**: TypeScript (ES2024) for extension + React 18 TSX for webview  
**Primary Dependencies**: VS Code API, SQL Tools Service client, @fluentui/react-components  
**Storage**: N/A (in-memory webview + extension state)  
**Testing**: `yarn test` in `extensions/mssql/` (unit tests for reducers/helpers)  
**Target Platform**: VS Code extension + webview  
**Project Type**: Multi-extension monorepo; changes scoped to `extensions/mssql/`  
**Performance Goals**: UI remains responsive; database list fetch is async and does not block host  
**Constraints**: Load on focus only; required-field gating by auth type; always include `<default>`; no error UI on load failure; keep database value on auth/server changes; avoid `setTimeout` in webview  
**Scale/Scope**: Single connection dialog flow; database lists may be large but are fetched per focus

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- TypeScript-First: PASS (extension + webview TS/TSX)
- VS Code Extension Patterns: PASS (use existing webview controller + RPC patterns)
- React Webview Standards: PASS (no `setTimeout`, use existing patterns)
- Test-First: PASS (add/update tests before implementation)
- Build Verification: PASS (plan to run `yarn build`, `yarn lint src/ test/`, `yarn package`)
- Code Quality Gates: PASS (ESLint/Prettier/copyright headers)
- Simplicity & YAGNI: PASS (only combobox + list loading changes)
- Extension Independence: PASS (changes isolated to `extensions/mssql/`)
- Security Requirements: PASS (no secrets persisted; use existing connection handling)

## Project Structure

### Documentation (this feature)

```text
specs/001-database-combobox/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
extensions/mssql/
├── src/
│   ├── connectionconfig/
│   │   ├── connectionDialogWebviewController.ts
│   │   └── formComponentHelpers.ts
│   ├── forms/
│   │   └── formWebviewController.ts
│   ├── reactviews/
│   │   ├── common/forms/form.component.tsx
│   │   └── pages/ConnectionDialog/
│   │       ├── connectionFormPage.tsx
│   │       └── components/ (new database combobox component)
│   └── sharedInterfaces/
│       ├── connectionDialog.ts
│       └── form.ts
└── test/ (connection dialog reducer/helper tests)
```

**Structure Decision**: Use existing MSSQL extension webview + controller structure; add a
database combobox component and list-loading logic within the connection dialog stack.

## Complexity Tracking

No constitution violations.
