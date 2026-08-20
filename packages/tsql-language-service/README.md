# `@vscode-mssql/tsql-language-service`

Host-neutral T-SQL parsing and editor intelligence for the vscode-mssql preview language service.
The package has no dependency on VS Code, a SQL driver, Langium, or another parser runtime.

## What it provides

- lossless Lezer syntax trees, SQL Server-style syntax diagnostics, and incremental updates;
- immutable semantic snapshots with scopes, symbols, calls, expression types, catalog binding, and
  semantic diagnostics;
- completion, completion resolution, hover, signatures, local and catalog definition descriptors,
  references, rename, document symbols, selection ranges, and folding;
- semantic coloring over the same syntax and semantic snapshot;
- SQLCMD projection and source-coordinate mapping;
- immutable, generation-pinned metadata contracts with null, in-memory, Simple Query, and dev/query
  adapters;
- in-process, Node worker, and browser-worker protocol surfaces;
- snapshot-consistent performance, reuse, metadata, and privacy-safe observability.

Formatting and inlay hints are intentionally not part of the public contract.

The package is under active preview development. See the [capability matrix](docs/readiness/CAPABILITY_MATRIX.md)
and [current readiness report](docs/readiness/CURRENT_READINESS.md) before relying on a partial feature.

## Shared snapshot model

Opening or changing a document publishes one `DocumentAnalysisSnapshot` containing its text,
SQLCMD projection, syntax, semantics, metadata generation, diagnostics, and statistics. Completion,
hover, coloring, folding, definitions, signatures, and other features read that snapshot; they do
not run their own parser or binder.

```ts
import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
} from "@vscode-mssql/tsql-language-service";

const metadata = new InMemoryMetadataProvider({
    environment: { currentDatabase: "ApplicationDb", defaultSchema: "dbo" },
    databases: [{ name: "ApplicationDb" }],
    schemas: [{ database: "ApplicationDb", name: "dbo" }],
});
const runtime = new InProcessLanguageServiceRuntime(
    new LezerSyntaxService(),
    new CatalogSemanticBinder(),
    metadata,
);
const features = new TsqlLanguageFeatureService(runtime, metadata);

await runtime.open("file:///query.sql", 1, "SELECT * FROM dbo.");
const completion = features.completion("file:///query.sql", 1, 18);
```

## Metadata providers

A provider publishes immutable generations. `pin()` returns the exact view used for binding, so a
feature cannot observe a catalog newer than the semantic snapshot it is reading. Section states
distinguish unknown, loading, ready, partial, stale, and failed data. Missing-object diagnostics are
emitted only from authoritative data.

The Simple Query adapter intentionally generates read-uncommitted catalog query variants rather than
rewriting SQL text. Runtime options bound page sizes, result limits, cache sizes, default schema, and
latency budgets. Connection strings and credentials belong to the host and must not be committed.

## SQLCMD

`SqlCmdDocumentService` creates projected SQL and a source map without opening files or executing
commands. Hosts provide include contents and connection resolution. `SourceMappedFeatureService` and
`SourceMappedColorizationService` translate requests and results consistently; unmapped directive or
include text returns a neutral result.

## Workers

The worker protocol carries serializable facts, document versions, edits, feature requests, and
results. Node and browser clients share the protocol. The extension preview currently uses the
in-process runtime; the worker API is available for evaluation and does not change the analysis
contracts.

## Development

From this directory:

```powershell
npm ci
npm run check:grammar
npm run lint
npm run typecheck
npm run test:offline
npm run test:types
```

Additional lanes:

```powershell
npm run test:integration
npm run test:performance
npm run test:shuffled
npm run test:sqlcmd
npm run test:identifiers
npm run test:workers
npm run test:browser-worker
npm run test:cancellation
npm run test:metadata-concurrency
npm run test:large-catalog
```

`test:offline` includes every non-live suite, including corpus and performance gates. `test:all`
additionally includes live integration tests and therefore requires the documented test database.
Correctness suites use normal Node file isolation; only the retained-memory performance lane opts
into a shared process.

## Grammar generation

Generated parser and term files are committed. Every build and test lane verifies the input/output
stamp or regenerates stale output before TypeScript compilation. To regenerate deliberately:

```powershell
npm run build:grammar
npm run check:grammar
```

Do not edit generated parser files. Grammar changes belong in
`src/syntax/lezer/grammar/tsql.grammar` with focused positive, negative, incomplete-input, and
incremental/fresh tests.

## Benchmarks

Parser, semantic, catalog-feature, dialect, worker, and full language-service lifecycle benchmarks
live under `benchmarks/`, separate from correctness tests. The lifecycle benchmark measures first and
warm features after open, edit, refresh, and rebind; source mapping; in-process extension-host
heartbeat stalls; worker transfer/heartbeat; and shared-versus-per-document catalog memory.

```powershell
npm run benchmark:smoke
npm run benchmark:language-service -- --samples 10 --warmups 3 `
  --json benchmarks/generated/language-service.json
```

See [benchmarks/README.md](benchmarks/README.md) for methodology and interpretation.

## Architecture and project state

- [Architecture](docs/architecture/ARCHITECTURE.md)
- [Capability matrix](docs/readiness/CAPABILITY_MATRIX.md)
- [Current readiness](docs/readiness/CURRENT_READINESS.md)
- [Active backlog](docs/backlog/ACTIVE_BACKLOG.md)
- [Implementation history](docs/history/IMPLEMENTATION_HISTORY.md)
- [Audit remediation plan](docs/analysis/LANGUAGE_SERVICE_AUDIT_REMEDIATION_PLAN.md)
- [Grammar provenance](GRAMMAR_PROVENANCE.md)

## License

Copyright Microsoft Corporation. Licensed under the repository MIT license.
