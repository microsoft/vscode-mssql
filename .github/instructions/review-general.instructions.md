---
applyTo: "extensions/mssql/src/**"
---

# Code Review Instructions

Use these alongside standard good practices when reviewing code.

## Backend Code

- DO check for places where an identity for a connection is used other than its ID.

## UIs

- DO check for direct use of a state object instead of selectors.
- DO check for instances where a selector is only passed as a property to other components, and it should be pushed down.

## Code Health

- DO check for duplicated code when we already have functions somewhere.
- DO NOT write custom functions when a library is already used in the extension (or part of the node runtime) to perform that function.

## Localization

- DO check for strings in UIs and user-facing messages that should be localized.
- DO check for duplication of strings within localization constants files, and suggest moving good candidates to the "common" bundle.
- DO NOT comment on presence, lack of presence, or correctness of translations inside localization files (`*.l10n.json`, `*.xlf`, `*.lcl`). Those are handled in a separate process.
- React/webview frontend localized strings go in: `extensions/mssql/src/reactviews/common/locConstants.ts`
- All other localized strings go in: `extensions/mssql/src/constants/locConstants.ts`
- "common" bundles: `LocConstants.common` for React strings, `LocConstants.Common` for backend strings.
