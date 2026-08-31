# Agent Guidance

## Start Here

- Use [DEVELOPMENT.md](DEVELOPMENT.md) for setup, build, test, localization, and debugging
  workflows.
- Treat package scripts, workspace configuration, and test configuration as the source of truth
  when documentation disagrees.
- Before finishing a change, lint and test the target you changed. DEVELOPMENT.md has the commands.

## Extension Toolkit

- `extension-toolkit/base` must remain independent of VS Code and the toolkit's VS Code layer.
- `extension-toolkit/vscode` may depend on `base` and the VS Code API.
- Production code must not import `extension-toolkit/vscode/testing`.
- Import an explicit toolkit layer; do not import from the package root.

## MSSQL

- Localize every user-facing string. Webview strings belong in
  `extensions/mssql/src/webviews/common/locConstants.ts`; other extension strings belong in
  `extensions/mssql/src/constants/locConstants.ts`.
- Reuse localized strings only when their semantic meaning is identical. Use parameterized strings
  instead of concatenating or parsing translated display text.
- Keep shared non-display values in the appropriate `constants.ts` only when they represent a
  genuine shared invariant; leave one-off implementation details near their use.
- Do not hand-edit localization bundles, XLIFF files, or `localizedConstants.ts`.
- Treat a connection ID as its identity. Do not compare or key connections using display
  properties.
- Use `FluentSlickGrid` rather than importing `SlickgridReact` directly. Use `useVscodeSelector`
  for shared webview state and keep component-only state local.
- Virtualize long lists with the repository's existing virtualization libraries.
- During webview startup, use `requestAnimationFrame` for visual synchronization or `queueMicrotask` for immediate
  nonvisual work instead of a zero-delay timeout.

## Tests

- Use Sinon, Chai `expect`, and sinon-chai in MSSQL unit tests. Reuse helpers from
  `extensions/mssql/test/unit/utils.ts`.
- Use a Sinon sandbox and `createStubInstance` for concrete classes. Minimal plain-object casts are
  acceptable for interface-only APIs.
- Extension-toolkit tests use the Node.js test runner. Match the existing tests under packages/extension-toolkit.
- Assert telemetry and logging payloads rather than incidental call order, indexes, or exact call
  counts. Await asynchronous UI rendering before asserting.

## T-SQL Grammar

- `extensions/mssql/syntaxes/SQL.plist` is the registered TextMate grammar.
- General T-SQL keywords normally use `keyword.other.sql`; add a narrower scope only when a theme
  or consumer needs the distinction.
- Verify grammar changes in a new query editor after rebuilding and launching the extension.
