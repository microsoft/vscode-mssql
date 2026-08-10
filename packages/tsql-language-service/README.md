# T-SQL language service

`@vscode-mssql/tsql-language-service` is the host-neutral T-SQL editor engine used by vscode-mssql.
It owns parsing, normalized analysis, database metadata, and Langium document orchestration without
coupling those layers to VS Code.

The public layers are:

- `parser`: the attributed SaralSQL-derived T-SQL parser plus immutable batch-incremental snapshots.
- `metadata`: query-executor and repository contracts, immutable catalogs, and a Tedious strategy.
- `analysis`: parser-independent diagnostics, symbols, types, completion, navigation, and catalog
  contracts.
- `adapters`: the catalog-aware adapter translating the package parser into analysis contracts.
- `langium`: cancellable, generation-aware documents and parser-neutral LSP feature providers.
- `core`: a facade and factories that compose an engine strategy with Langium lifecycle services.

```text
Tedious / host metadata -> MetadataRepository -> immutable catalog
                                                   |
Saral incremental parser -> analysis adapter ------+-> Langium document -> LSP providers
```

The design uses Strategy for parser and query execution, Adapter for native parser/catalog models,
Repository for metadata snapshots, Factory for composition, and Facade for the public service. The
patterns define substitution boundaries; providers never open database connections and metadata
code never parses SQL.

The default facade uses `SaralSqlAnalysisEngine`. It provides immutable GO-batch updates, syntax and
catalog diagnostics, completion, hover types, signatures, symbols, definitions/references, rename,
semantic tokens, folding, selection ranges, lineage, and normalized DML targets. There is no second
parser dependency or compatibility delegate in the runtime.

```ts
import { createTsqlLanguageService } from "@vscode-mssql/tsql-language-service";

const service = createTsqlLanguageService();
const snapshot = service.analyze({ text: "select 1", uri: "file:///query.sql" });
console.log(snapshot.syntaxDiagnostics);
```

Catalog providers are synchronous views over a host-owned metadata cache. Increment the provider's
`version` whenever cached answers change; use `world: "open"` while metadata is incomplete so an
engine does not turn cache misses into false diagnostics.

## Incremental parsing

`IncrementalBatchParser` recognizes line-isolated SQLCMD `GO` separators outside comments, strings,
and quoted identifiers. An edit reparses only changed batches and reuses relative-offset parse
artifacts for unchanged batches. Materialization produces a conventional absolute-offset AST without
mutating earlier snapshots. Semantic layers currently refresh over the materialized program; parser
reuse and semantic work are reported separately in benchmarks.

## Metadata and live tests

`TediousQueryExecutor` is the built-in query strategy. Live tests are opt-in and read an ignored
`.env` file:

```dotenv
MSSQL_TEST_CONNECTION_STRING=Data Source=localhost,1433;User ID=sa;Password=...;Encrypt=True;Trust Server Certificate=True;Authentication=SqlPassword
```

No password or connection string is committed. Applications may instead implement
`SqlQueryExecutor` or provide an already-populated `SqlCatalogProvider`.

## SaralSQL attribution

The parser under `src/parser/saral` is derived from `@saralsql/tsql-parser` 0.4.7 at commit
`e95951c1ba48c41c026a1244ac23cedc2ced7fb7`, Copyright (c) 2026 Saral Simon Stalin, under the MIT
License. See [`third-party/saralsql/NOTICE.md`](third-party/saralsql/NOTICE.md) and
[`third-party/saralsql/LICENSE`](third-party/saralsql/LICENSE). Local incremental code is maintained
separately under `src/parser/incremental`.

## Development

```sh
npm run build
npm test
npm run lint
npm run benchmark -- --samples 30
```

Benchmarks live under `benchmarks/`, not the test tree. They compare whole parsing, whole analysis,
batch updates, AST materialization, malformed edits, GO-boundary edits, correctness checksums, and
optional retained memory on large generated SQL files.

See [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) for the editor-feature matrix,
release gates, and deliberately documented capability limits.
