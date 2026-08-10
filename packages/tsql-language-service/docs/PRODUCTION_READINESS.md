# Production readiness

This document records the behavior shipped by `@vscode-mssql/tsql-language-service` and the
remaining limits. A feature is not described as complete merely because a provider is registered.

## Editor surface

| Feature                        | Status    | Production behavior                                                                                                                                                                       |
| ------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completion and resolve         | Supported | Grammar context, local scopes, catalog objects and columns, routines, data types, DDL snippets, INSERT expansion, star expansion, quoting, and stale-result rejection.                    |
| Definitions                    | Supported | Exact in-document identities; external catalog objects open a lazily generated Script As Create virtual document.                                                                         |
| Diagnostics                    | Supported | SQL Parser-style syntax wording, document semantic checks, closed-catalog object/column checks, ordered local DDL visibility, cancellation, debounce, and `vscode-mssql` source branding. |
| Hover                          | Supported | Object kind, multipart source, alias identity, SQL type, and catalog nullability where known.                                                                                             |
| Signature help                 | Supported | Built-ins, catalog functions/procedures, `EXEC`, and `INSERT VALUES`; asynchronous results are version-gated.                                                                             |
| References, highlights, rename | Partial   | Exact document-local identities are supported. Project schema rename routes to the SQL project provider. Arbitrary workspace-wide database reference search is not implemented.           |
| Document symbols               | Supported | Statements and local declarations, including CTE hierarchy.                                                                                                                               |
| Folding                        | Supported | Comments, regions, batches/statements, parentheses, `BEGIN`/`END`, and `CASE` blocks.                                                                                                     |
| Selection ranges               | Supported | Tokens, multipart identifiers, expressions, parentheses, clauses, statements, and document.                                                                                               |
| Semantic coloring              | Supported | Full, range, and delta semantic tokens with stale-result rejection.                                                                                                                       |
| Inlay hints                    | Partial   | Conservative inferred output types and alias targets. Parameter-name and implicit-conversion hints are not emitted.                                                                       |
| Formatting                     | Partial   | Parser-aware indentation that preserves SQL tokens and comments. It is not a canonical query rewriter or SQL Tools Service formatting-parity implementation.                              |
| Code lens                      | Partial   | Connection/catalog state and refresh actions. Statement execution lenses remain outside this language-service package.                                                                    |

## Correctness boundaries

- The vendored parser is derived from SaralSQL 0.4.7 and is maintained locally with attribution.
- `GO`-batch updates reuse immutable parse artifacts, and a changed batch additionally reuses the
  statements that end inside the byte-identical prefix, so an edit reparses only from the first
  statement it can reach. Semantic analysis still refreshes over the materialized program, so
  incremental parser reuse does not imply incremental semantic analysis.
- A statement whose parse throws is recorded as an `ErrorStatement` and the parser resynchronizes to
  the next statement boundary, so one damaged statement no longer discards the statements after it.
- Catalog diagnostics use a closed-world catalog only after metadata is complete. An open catalog
  never turns a cache miss into `MSSQL208`.
- Script-local `CREATE`, `ALTER`, and `DROP` visibility is evaluated at the reference offset and
  persists correctly across `GO` batches.
- The independently authored SQLParser oracle and stress suites are regression references, not a
  claim that every SQL Server grammar production or diagnostic is implemented. See
  `test/oracle/GAP_MAP.md` for the reviewed corpus.

## Required validation

Before release, run:

```powershell
npm --prefix packages/tsql-language-service test
npm --prefix packages/tsql-language-service run lint
npm --prefix extensions/mssql run test:parser:unit
npm run build -- --target mssql
npm run lint -- --target mssql
```

Large-file performance is measured separately from tests. The exact-size harness validates 1, 10,
and 50 MiB files with canonical AST checksums and batch-reuse assertions; the integrated analysis
harness additionally measures open/closed metadata snapshots. See `benchmarks/README.md`.
