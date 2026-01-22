<!--
Sync Impact Report
==================
Version change: 0.0.0 → 1.0.0 (Initial ratification)
Modified principles: N/A (new constitution)
Added sections:
  - Core Principles (4 principles: Code Quality, Testing Standards, UX Consistency, Performance)
  - Technology Stack
  - Development Workflow & Quality Gates
  - Governance
Removed sections: None
Templates requiring updates:
  ✅ plan-template.md - Constitution Check section compatible
  ✅ spec-template.md - Requirements alignment verified
  ✅ tasks-template.md - Task categorization aligns with principles
Follow-up TODOs: None
-->

# MSSQL Extension for VS Code Constitution

## Core Principles

### I. Code Quality First

All code changes MUST adhere to established quality standards that ensure maintainability, readability, and consistency across the codebase.

**Non-Negotiable Rules:**
- All TypeScript code MUST compile without errors (`yarn build` MUST succeed)
- All code MUST pass linting checks (`yarn lint src/ test/` MUST return zero errors)
- Code formatting MUST follow Prettier configuration (see `prettier.config.mjs`)
- ESLint rules are enforced via pre-commit hooks and MUST NOT be bypassed
- Mass formatting changes MUST be recorded in `.git-blame-ignore-revs`
- New code MUST follow existing architectural patterns (controllers, services, models)

**Rationale:** Consistent code quality reduces technical debt, simplifies code review,
and enables faster onboarding of new contributors. The extension serves millions of
developers and MUST maintain professional-grade code standards.

### II. Testing Standards

Testing is mandatory for all feature work to ensure reliability and prevent regressions
in a widely-used developer tool.

**Non-Negotiable Rules:**
- Unit tests MUST accompany new features and bug fixes
- Tests MUST be independently runnable via `yarn test` with grep patterns for targeting
- Contract tests MUST exist for any new service interfaces or API changes
- Integration tests MUST cover critical user workflows (connection, query execution)
- E2E/smoke tests (`yarn smoketest`) MUST pass before release milestones
- Tests MUST NOT rely on `setTimeout` in webview code (use `requestAnimationFrame`
  or `queueMicrotask` instead due to Chrome throttling)

**Rationale:** The MSSQL extension integrates with SQL Server, Azure SQL, and Fabric.
Database operations are stateful and error-prone; comprehensive testing catches issues
before they impact users in production environments.

### III. User Experience Consistency

All user-facing features MUST provide a seamless, intuitive experience consistent with
VS Code design patterns and the extension's established interaction paradigms.

**Non-Negotiable Rules:**
- UI components MUST follow VS Code's design language and theming support
- React webview components MUST be accessible (keyboard navigation, screen readers)
- User-facing strings MUST be localized via the `l10n/` infrastructure
- Error messages MUST be actionable, providing clear guidance for resolution
- New features MUST NOT break existing workflows or keyboard shortcuts
- Connection management MUST support multiple profiles and quick reconnection
- GitHub Copilot integration features MUST use the `@mssql` chat participant pattern

**Rationale:** Users depend on consistent behavior across VS Code extensions. Breaking
established patterns creates friction, increases support burden, and damages the
extension's reputation in the marketplace.

### IV. Performance Requirements

All features MUST meet performance targets to ensure responsive user experience,
especially when working with large databases and result sets.

**Non-Negotiable Rules:**
- VSIX package size MUST remain under 25MB for online distribution
- Webview initialization MUST NOT use `setTimeout` (throttled to 1s when hidden)
- Large result sets MUST render progressively without blocking the UI
- Object Explorer MUST support lazy loading for large database hierarchies
- Query execution MUST display timing metrics and support cancellation
- Watch mode (`yarn watch`) MUST provide sub-second recompilation feedback

**Rationale:** Developers use this extension in their daily workflow. Slow performance
interrupts focus and reduces productivity. Performance budgets prevent gradual
degradation over time.

## Technology Stack

The following technology choices are standardized and MUST be followed for consistency:

| Layer | Technology | Version Requirement |
|-------|------------|---------------------|
| Runtime | Node.js | v20.19.4+ |
| Package Manager | Yarn | v1.22+ |
| Language | TypeScript | Strict mode enabled |
| Extension Host | VS Code Extension API | Current stable |
| Webviews | React | TypeScript-based components |
| Bundler | esbuild | For production bundles |
| Linting | ESLint | Config in `eslint.config.mjs` |
| Formatting | Prettier | Config in `prettier.config.mjs` |
| SQL Backend | SQL Tools Service (STS) | .NET-based language server |

**Changing Stack:** Proposals to change technology stack require Constitution amendment.

## Development Workflow & Quality Gates

### Pre-Commit Validation (REQUIRED)

Every commit MUST pass these gates before being pushed:

```bash
yarn build                 # Code compiles without errors
yarn test                  # All unit tests pass
yarn lint src/ test/       # Linting passes (source files only)
yarn package --online      # Extension packages successfully
```

### PR Review Requirements

All pull requests MUST:
1. Pass CI pipeline (build, lint, unit tests)
2. Include test coverage for new functionality
3. Update localization files if user-facing strings changed
4. Follow the webview code review checklist (no `setTimeout` patterns)
5. Document breaking changes in CHANGELOG.md

### Build Commands Reference

| Command | Purpose | Timeout |
|---------|---------|---------|
| `yarn install` | Install dependencies | 120s (NEVER CANCEL) |
| `yarn build` | Full build | 60s (NEVER CANCEL) |
| `yarn lint src/ test/` | Lint source only | 30s |
| `yarn package --online` | Create VSIX | 60s (NEVER CANCEL) |
| `yarn watch` | Dev mode | Continuous |

## Governance

This Constitution supersedes all other development practices for the MSSQL extension.

**Amendment Process:**
1. Propose changes via PR to `.specify/memory/constitution.md`
2. Changes require team review and approval
3. Version MUST be incremented per semantic versioning:
   - MAJOR: Backward-incompatible principle changes
   - MINOR: New principles or expanded guidance
   - PATCH: Clarifications and typo fixes
4. All amendments MUST include migration plan for existing work

**Compliance Verification:**
- All PRs MUST reference applicable principles in review
- Constitution Check in `plan-template.md` MUST be completed before implementation
- Violations MUST be documented with explicit justification in Complexity Tracking

**Runtime Guidance:** Refer to `extensions/mssql/AGENTS.md` for detailed development
workflows, validation scenarios, and troubleshooting guidance.

**Version**: 1.0.0 | **Ratified**: 2026-01-21 | **Last Amended**: 2026-01-21
