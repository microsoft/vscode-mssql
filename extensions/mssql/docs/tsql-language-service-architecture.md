# Package T-SQL language-service architecture

The beta SQL editor path is implemented by `@vscode-mssql/tsql-language-service`. The extension no
longer owns a parser implementation. It supplies connection metadata and VS Code conversions around
the package's parser-independent contracts.

## Layers

```text
Tedious / extension queries -> immutable catalog provider
                                      |
batch-incremental parser -> analysis snapshot -> document store -> VS Code providers
```

- Parser: attributed SaralSQL-derived grammar plus immutable `GO`-batch reuse.
- Analysis: diagnostics, types, symbols, completion, references, signatures, lineage, and DML
  targets behind `SqlAnalysisSnapshot`.
- Metadata: query-executor/repository strategies and synchronous catalog snapshots.
- LSP: generation-aware documents, cancellation, and parser-neutral feature providers.
- Extension: connection ownership, bounded metadata loading, snippets, LSP/VS Code conversion, and
  feature registration.

Structural features use the immediate parse snapshot. Metadata-dependent diagnostics, hover,
definition, and completion use a versioned catalog snapshot; delayed results are rejected after an
edit or document close.

## Verification

Run package tests and benchmarks from `packages/tsql-language-service`:

```sh
npm test
npm run benchmark -- --samples 30
```

Run extension coverage from `extensions/mssql`:

```sh
npm run test:parser:unit
npm run test:parser:integration
```

The comparison oracle has a fixed denominator and exercises syntax, recovery, diagnostic spans,
DML targets, scopes, symbols, references, types, and completions. Large-file benchmarks separately
report whole parsing, whole semantic analysis, batch update, materialization, artifact reuse,
checksum equivalence, and retained memory.
