# Real-world T-SQL regression fixtures

This directory contains a package-owned copy of the team-maintained SQL regression workspace. The files were renamed and grouped by purpose so a failing script is easy to locate:

- `catalog/` — catalog and security statements
- `errors/` — scripts that exercise runtime SQL errors rather than parser errors
- `json/` and `xml/` — SQL Server structured-data features
- `queries/` — representative query and result-set shapes
- `stress/` — large, malformed, or message-heavy scripts
- `temp/` — temporary table and table-variable behavior
- `workspace-paths/` — fixtures whose original paths contained spaces or punctuation

[`manifest.json`](./manifest.json) is the inventory and expectation source. Every SQL file must be listed exactly once. It records the original filename and any expected syntax or document-local semantic diagnostics. Intentionally malformed scripts keep exact recovery expectations rather than being treated as clean input.

The regression suite uses the null metadata provider. It therefore validates lossless parsing, recovery, and document-local semantics without inventing catalog errors for objects that may exist on a connected server. These scripts are read as text and are **not executed**. The one password-like sample in the source workspace is replaced with a fixture placeholder.

After compiling the package, run only this suite with:

```powershell
node --test --test-isolation=none test/regression/real-world/sql-fixtures.test.js
```
