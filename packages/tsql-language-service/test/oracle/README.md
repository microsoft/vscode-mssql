# Portable behavior oracle

`oracleFixtures.mjs` is deliberately independent of parser implementations, Langium, VS Code, and LSP
types. A language-service adapter can translate the synthetic catalog and the assertion records into
its own snapshot API.

Runner rules:

- Run every fixture. Unsupported operations are failed results, not skipped cases.
- Selector occurrences are zero-based and spans are half-open UTF-16 offsets. `eof` selects the
  zero-width end of the document.
- Completion positions use the end of their `at` selector. Other point queries use a position inside
  the selected token. Diagnostic and mutation assertions use the entire selected span.
- `diagnostic.exactCount` is required. Diagnostic silence cannot satisfy an invalid-input fixture,
  and `diagnostic-set` with `exact: []` rejects false positives.
- `definition` is the expected declaration identifier span. `references` contains the complete
  expected occurrence inventory unless a future assertion explicitly says otherwise.
- Object visibility is position-aware. A local CREATE or ALTER affects later statements; DROP hides
  the object; `GO` resets variables and table variables but not session temp tables.
- Incremental fixtures compare an initial and updated immutable snapshot. Full re-analysis may pass
  correctness assertions, but its strategy must be reported as `full-reanalysis`. Only an engine
  with a native edit/session API may report `native-incremental` and reuse metrics.

The included Node test validates fixture integrity and can run without package wiring:

```powershell
node --test packages/tsql-language-service/test/oracle/oracleIntegrity.test.mjs
```

See `GAP_MAP.md` for prioritization and `PROVENANCE.md` for the clean-room/licensing boundary.
