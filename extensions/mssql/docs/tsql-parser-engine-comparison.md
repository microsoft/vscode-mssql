# T-SQL parser decision

The extension uses the parser and analysis stack in `@vscode-mssql/tsql-language-service` as its
only editor engine.

The package vendors the essential SaralSQL parser source with MIT attribution, adds immutable
`GO`-batch incremental parsing, and layers catalog-aware analysis over a parser-independent
contract. This keeps parser, metadata, Langium lifecycle, and VS Code integration independently
replaceable while avoiding two active semantic models.

## Acceptance evidence

- The fixed 26-scenario comparison oracle passes all syntax, recovery, diagnostic-span, DML,
  scope, symbol, reference, type, and completion cases.
- The broader package and extension suites cover SQL Server DML, CTEs, derived tables, PIVOT,
  UNPIVOT, APPLY, named windows, temp/table variables, hover, navigation, semantic tokens, folding,
  and stale metadata races.
- Closed catalogs emit SQL Server-compatible `MSSQL208` diagnostics, including INSERT targets.
- Exact SQL type text is retained for hover and aggregate result types.
- Incremental benchmarks report changed-batch work separately from whole parsing and semantic
  materialization; checksum checks fail the benchmark if incremental output diverges.

Known partial areas are declared through `SqlAnalysisCapabilities` instead of being presented as
complete. In particular, arbitrary expression type inference and generated-rowset column binding
remain conservative, and semantic analysis is refreshed over the materialized program after parser
artifacts are reused.
