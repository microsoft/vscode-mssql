# T-SQL Language Service

`@vscode-mssql/tsql-language-service` is a host-neutral, incremental T-SQL language service for Node.js and browser hosts. It owns syntax, semantic binding, and editor features while keeping database access, VS Code, and LSP transport details outside the core.

This package starts from a clean foundation. It does not depend on SaralSQL, Langium, SQL Tools Service, VS Code APIs, or a SQL driver.

## Product goals

- Parse T-SQL incrementally with Lezer and recover predictably from incomplete editor input.
- Bind scopes, symbols, types, references, and catalog objects without performing I/O.
- Serve completion, hover, definition, references, rename, diagnostics, symbols, folding, selection ranges, semantic tokens, signature help, and formatting through host-neutral contracts.
- Run identically in process, in a persistent Node worker, and in a browser Web Worker.
- Consume immutable metadata views supplied by the host.
- Remain responsive while metadata is loading, stale, unavailable, or refreshing.
- Expose detailed local language-service statistics for diagnostics and support.
- Measure correctness and performance independently using deterministic corpora.

## Non-negotiable rules

1. Parsing and semantic binding never perform database I/O.
2. A feature request never waits for metadata refresh.
3. Raw Lezer nodes never escape the Lezer adapter and typed syntax facade.
4. Syntax, semantic, and metadata products are immutable versioned snapshots.
5. Every asynchronous result is checked against its document and metadata versions before publication.
6. An unavailable metadata section is not equivalent to a confirmed missing SQL object.
7. Node and browser workers implement the same protocol as the in-process runtime.
8. Performance results are invalid unless their corresponding correctness checks pass.

## Architecture

```text
                                          SQL Server
                                              ^
                                              | asynchronous refresh
                                              |
                                  +-----------+------------+
                                  | Host Metadata Provider |
                                  +-----------+------------+
                                              | publishes
                                              v
                                      MetadataView M42
                                              |
didOpen / didChange                           |
          |                                   |
          v                                   |
  Document Coordinator                        |
          |                                   |
          +-- TextSnapshot D105               |
          |                                   |
          +-- Lezer SyntaxSnapshot D105       |
          |               |                   |
          |               v                   |
          +-- Incremental Semantic Binder <---+
                          |
                          v
                SemanticSnapshot D105/M42
                          |
             +------------+-------------+
             |            |             |
             v            v             v
         Completion     Hover       Diagnostics
```

Dependency direction:

```text
text <- syntax <- semantics <- features <- runtime/LSP host
                    ^
                    |
              metadata contracts
```

Forbidden dependencies:

- `syntax` must not import metadata, semantics, LSP, VS Code, or database code.
- `semantics` may read only a pinned `MetadataView`; it must not import metadata loaders.
- `features` must not execute queries or initiate blocking refresh work.
- portable package modules must not import VS Code APIs.
- database credentials and live connection objects must never enter a worker.

## Logical module layout

```text
src/
  text/             UTF-16 offsets, immutable text, line maps, edits
  syntax/           Lezer adapter and typed syntax facade
  semantics/        scopes, symbols, types, binding, dependency indexes
  metadata/         portable contracts and offline providers
  coloring/         lexical and semantic classifications plus incremental token deltas
  features/         remaining host-neutral editor features
  formatting/       document, range, and on-type formatting
  runtime/          document coordination and scheduling
  worker/           shared protocol plus Node and browser transports
  observability/    status snapshots, counters, and rolling timings
  lsp/              protocol-facing contracts and conversions
  adapters/         optional host adapter contracts
test/
  architecture/     import-boundary and determinism checks
  contract/         shared runtime and metadata provider suites
  syntax/           grammar, recovery, and incremental equivalence
  semantics/        binding and invalidation
  features/         marker-driven language feature scenarios
  worker/           in-process, Node, and browser protocol parity
  regression/       minimized product regressions
benchmarks/
  generators/       deterministic SQL and catalog generation
  parser/           full and incremental parsing
  semantics/        full and incremental binding
  features/         completion, hover, definition, diagnostics
  metadata/         refresh, indexing, publication, and transfer
  worker/           responsiveness and transport overhead
  external/         optional ScriptDOM and SqlParser comparison harnesses
  scenarios/        editor-like request sequences and soak workloads
```

These are logical boundaries inside one package. A layer becomes another npm package only when independent deployment or reuse requires it.

## Text and syntax

All internal offsets and ranges are UTF-16. LSP position conversion occurs at the protocol boundary.

Lezer owns only the compact incremental concrete syntax tree. The language service retains the prior tree and applies changed ranges through reusable tree fragments. The public syntax layer exposes typed, lazy wrappers rather than node-name strings and child positions.

Document text remains the single lossless source of truth. The Lezer tree is a compact structural
index: ordinary whitespace is skipped, comments remain available as named nodes, and source slices
recover exact punctuation and trivia from node ranges. A second retained token tape or custom
incremental lexer is not part of the architecture unless a measured formatter or transformation
requirement later justifies one.

Lezer tree fragments provide incremental lexing and parsing. Sequential LSP edits transform the
same fragment set in order and parse the final document once. Incremental and fresh results must
normalize to the same node kinds, ranges, errors, and statement boundaries.

Initial syntax scaffolding recognizes scripts, batches, generic statement boundaries, trivia, and recovery nodes. Grammar coverage then grows by coherent T-SQL feature areas.

## Semantic binding

The binding hierarchy is:

```text
Script
  +-- Batch
        +-- Statement
              +-- Query block
```

A batch is the primary flow unit. Statements and query blocks are normal incremental recomputation units. Semantic reuse keys contain a syntax fingerprint, incoming flow-state version, relevant metadata dependency versions, and language settings. Lezer node identity is never used as a durable semantic key.

Binding phases are:

1. Collect local declarations such as CTEs, aliases, variables, parameters, temporary tables, and local DDL.
2. Construct explicit nested scopes.
3. Resolve table and rowset sources.
4. Bind expressions and references.
5. Infer types, nullability, and result shapes.
6. Build shared position, definition, reference, visibility, and dependency indexes.

After an edit, the binder rebinds the smallest affected unit and continues downstream only when the unit's exported environment changes.

## Metadata

The core reads an immutable `MetadataView` captured once per operation. A view reports a generation and section completeness. Resolution distinguishes resolved, ambiguous, confirmed not found, and unknown because metadata is pending, unavailable, partial, or stale.

Invalid-object diagnostics are emitted only when the relevant namespace is complete and resolution is confirmed `notFound`.

Resolution order is:

1. query-local declarations;
2. script and session declarations, including temporary tables and local DDL;
3. the pinned database metadata view.

### dev/query metadata adapter

The extension-side adapter projects the immutable, generation-stamped catalog from `dev/query` into this package's `MetadataProvider` contract. It preserves readiness, collation-aware resolution, indexed search, default schema, environment capabilities, and asynchronous hydration requests. The package never imports `MetadataService` or its storage model.

### Simple-query metadata adapter

The portable adapter consumes a small `SimpleQueryExecutor` interface supplied by the host. In vscode-mssql, that executor delegates to the existing `executeSimpleQuery(connectionUri, query)` API.

Refresh is asynchronous, staged, and set-based:

1. load environment, databases, schemas, and object identities;
2. page object identities and publish immutable partial generations;
3. hydrate columns and routine parameters only for requested objects;
4. coalesce in-flight hydration by section and object;
5. retain usable prior data and mark it stale when refresh fails.

Concurrent refresh requests are coalesced. Cancellation detaches an individual caller without corrupting shared work. Query, mapping, indexing, and publication durations are recorded separately.

The package also supplies null and in-memory providers for offline operation and deterministic tests. Every provider runs through one shared contract suite.

Object definition retrieval is a separate asynchronous host service, normally backed by vscode-mssql's scripting API. Definitions are not bulk metadata and are never required for parsing or binding.

## vscode-mssql preview integration

The package is integrated into the vscode-mssql extension behind the opt-in
`mssql.preview.languageService` setting. The default is `false`, so installing or
debugging this branch does not change the production language service unless the preview is
explicitly enabled.

When enabled, the extension currently:

- mirrors every open SQL document into a persistent language-service runtime;
- converts edits to equivalent UTF-16 changes and exercises Lezer tree-fragment reuse;
- publishes preview syntax and scaffold semantic diagnostics under the separate
  `vscode-mssql-preview` diagnostic collection;
- uses the connected editor's existing `executeSimpleQuery` API to publish immutable metadata;
- refreshes metadata asynchronously without delaying document parsing;
- optionally shows one concise status CodeLens, when
  `mssql.preview.languageServiceStatsCodeLens` is also enabled, that opens a live, read-only JSON
  statistics document; and
- provides **MSSQL: Refresh T-SQL Language Service Metadata (Preview)** for manual refresh.

The preview is an exclusive test mode. Completion, hover, definition, references, semantic tokens,
formatting, and other production editor-language results are suppressed while the flag is enabled.
Features that the preview has not implemented are deliberately unavailable rather than silently
falling back to SQL Tools Service. Connections, query execution, and other non-language SQL Tools
Service operations remain active. The live stats document reports the current route for each
feature.

To test the integration during development:

1. Build the `tsql-language-service` and `mssql` workspace targets.
2. Start the extension-development host using the repository's **Launch Extension** configuration.
3. Enable **MSSQL: Preview › Language Service** in the development host.
4. To show the status CodeLens, also enable
   **MSSQL: Preview › Language Service Stats Code Lens**.
5. Open a SQL editor and connect it normally.
6. Click the `T-SQL preview` CodeLens to inspect parse, bind, metadata, and runtime state.
7. Edit the document and confirm `syntax.mode` changes to `incremental` in the live stats document.
8. Run the metadata-refresh preview command and confirm the metadata generation advances.

The initial preview runs in process so it can consume the host-owned immutable metadata view. The
Node and browser worker transports remain in the package and are contract-tested; preview routing
will switch to them after the compact metadata-generation transfer is implemented.

## Feature request behavior

Features consume published syntax and semantic snapshots. They do not independently parse or bind.

Completion returns local symbols, grammar candidates, and cached metadata immediately. If useful metadata is absent, it returns an incomplete result and schedules non-blocking hydration. Expensive documentation and object definitions are resolved lazily.

Syntax diagnostics publish immediately. Semantic diagnostics publish later and carry document and metadata versions. Stale computations are discarded before publication.

The initial feature surface includes:

- completion and completion resolution;
- hover;
- definition;
- references and document highlights;
- prepare-rename and rename;
- syntax and semantic diagnostics;
- document symbols;
- folding ranges;
- selection ranges;
- semantic tokens;
- signature help;
- full-document, range, and on-type formatting.

Inlay hints and CodeLens are not core language features in the initial implementation.

## Coloring

Coloring is a first-class host-neutral service rather than a VS Code-specific token encoder. Its
single legend covers lexical classifications such as keywords, comments, strings, numbers, and
operators, plus semantic classifications such as schemas, tables, views, columns, routines,
variables, parameters, aliases, CTEs, temporary tables, and SQL types.

The coloring strategy consumes the same immutable syntax and semantic snapshots as other features.
It supports full-document, range, and incremental token-array results carrying document and
metadata versions. Tokens use UTF-16 offsets; the VS Code/LSP adapter owns line/character encoding
and semantic-token integer packing.

`TsqlColorizationService` combines three layers per token. The lexical kind classifies comments,
strings, numbers, operators, keywords, and variables. The syntax tree then gives each name its role,
so a multipart name resolves from server through database, schema, and object down to column, and a
contextual keyword used as a name is colored as the name. Bound symbols finally refine those roles
into the kind an object actually has and add the declaration, definition, and write modifiers.

Each layer degrades independently: a document with no catalog behind it still colors completely from
its tree, and recovery over damaged input falls back to the plain identifier role rather than
inventing one. Nothing inside a comment, a string, or an unterminated string is ever reclassified as
a symbol.

## Folding

Folding ranges come from the same published parse tree. Statements, module bodies, `BEGIN`/`END`
blocks, bracketed definition lists, subqueries, and `CASE` expressions each collapse from their own
header line, and `BEGIN TRY`/`BEGIN CATCH` collapse separately because the pairs are read from the
block keywords rather than from the enclosing statement. A batch folds only where `GO` actually
groups several statements, so a script without batch separators does not offer to collapse itself.

Clauses that begin with their own keyword — `FROM`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY` —
fold from that keyword, as do bracketed hint, option, constraint, `PIVOT`, and window clauses. A
select list is deliberately excluded: it starts at its first expression, which would put an arrow in
the middle of the statement holding it. A transaction has no enclosing node, so `BEGIN TRANSACTION`
is paired with the `COMMIT` or `ROLLBACK` that closes it, innermost first.

Runs of line comments, block comments, string literals that run over several lines, and the
`-- #region` and `-- #endregion` markers the SQL language configuration declares all fold with their
own kinds. Ranges use UTF-16 offsets like every other feature, and the service guarantees what a
host needs before it converts them: more than one line each, one range per starting line, and proper
nesting. A structural range stops at the last code it contains, so trailing comments and blank lines
are never swallowed by the construct above them.

An editor caps how many regions it will fold and drops the excess in document order, which leaves
the end of a long script unfoldable. A caller may pass that cap as a range budget, and the service
then spends it on the widest regions, so structure survives across the whole document.

## Formatting

Formatting uses the lossless token stream and typed syntax facade. It does not require metadata or semantic binding. Options include indentation, keyword casing, comma placement, and safe line breaks.

A formatting result is a collection of non-overlapping text edits. Applying those edits must produce a fresh parse equivalent to the original normalized syntax; tests reject transformations that alter meaning.

## Runtime and workers

One document coordinator serializes open, change, and close operations for its URI and atomically publishes document snapshots. Different URIs remain independent. Background semantic work uses latest-wins scheduling.

Three runtimes implement one contract:

- in-process, for simple hosts, testing, and baseline measurements;
- a persistent Node `worker_threads` runtime;
- a persistent browser Web Worker runtime.

Workers own document text, Lezer trees, and semantic snapshots. Trees and semantic indexes do not cross the transport. Requests and responses carry document versions and metadata generations. The host and worker both reject stale results.

Metadata refresh remains on the host. Published metadata generations are transferred separately from document edits using serializable compact data. Credentials, drivers, and connection objects never enter the worker.

## Language-service statistics

The package exposes a read-only `LanguageServiceStats` snapshot and change event. It supports a detailed local “stats for nerds” experience rather than merely a CodeLens.

It reports:

- document identity, version, and size;
- full versus incremental parsing, elapsed time, changed ranges, reuse, and errors;
- binding state, elapsed time, units examined/reused/rebound, and diagnostics;
- metadata provider, generation, readiness by section, age, refresh duration, and cache behavior;
- runtime mode, worker queue depth, round-trip time, worker time, and failures;
- rolling feature latency, cancellations, and discarded stale results.

Opening the stats UI must not trigger parsing, binding, metadata enumeration, or database work. vscode-mssql owns presentation through a command, panel, status indicator, optional CodeLens entry point, “copy as JSON”, metadata refresh, rebind, and worker restart actions. Copied diagnostics exclude credentials, SQL text, and object names.

## Testing strategy

Highest-priority invariants are:

- incremental parse equals a fresh parse of the final text;
- incremental binding equals a fresh bind of the same syntax and metadata;
- parsers never throw on incomplete or mutated SQL;
- all ranges stay within the document;
- stale responses published equals zero;
- database calls from parsing, binding, or pure feature logic equals zero;
- metadata `unknown` never becomes a confirmed-invalid diagnostic;
- metadata refresh invokes the binder but causes zero parser calls;
- qualified per-object hydration never enumerates unrelated object details;
- all metadata providers and runtimes satisfy shared contract suites.

Test categories include focused grammar fixtures, incomplete typing prefixes, recovery and fuzzing, UTF-16 positions, scope and resolution, invalidation counters, marker-driven features, concurrency races, real SQL Server integration, architecture import boundaries, and the package-owned `test/corpus/tsql-conformance` broad corpus. The additional team regression workspace is organized under `test/fixtures/real-world-sql`; `test/regression/real-world/sql-fixtures.test.js` exposes one named test per script. Run `npm run test:fast` for the development loop, `npm run test:corpus` for the broad conformance gate, and `npm run test:all` for the complete offline suite. Run `npm run report:corpus` after compiling to see clean-file, raw-recovery-node, engine-flavor, version-hint, and timing totals without another repository checkout.

Real-server tests are opt-in and isolated under `test/integration`. Copy `.env.example` to the
package-local ignored `.env`, set `TSQL_INTEGRATION_CONNECTION_STRING`, and run
`npm run test:integration`. These tests use a test-only `tedious` executor; the production package
and browser bundles remain database-driver independent.

The T-SQL conformance corpus vendors open-source fixtures under their original MIT license; its manifest pins source provenance and integrity. Open-source grammar and tests may also inform conformance work under that license.

## Benchmark plan

Corpora are deterministic and generated; giant SQL files are not committed.

Standard source sizes are 5 KiB, 100 KiB, 1 MiB, and 10 MiB. A 100 MiB lane is manual soak work. Workloads cover valid query, DML, DDL, analytical and administrative SQL, plus incomplete and recovery-heavy text.

Parser measurements include cold and warm full parse, incremental edits at the beginning/middle/end,
sequential multi-edit batches, grammar-state-changing edits, paste/delete operations, malformed-input
scaling, visible nodes per KiB, tree consumption checksums, event-loop delay, throughput, latency,
peak memory, and retained memory.

Feature benchmarks include completion, hover, definition, diagnostics, references, semantic tokens, and formatting. Catalog scales include approximately:

| Scale    | Objects | Columns |
| -------- | ------: | ------: |
| Small    |     100 |   2,000 |
| Medium   |   5,000 | 100,000 |
| Customer |  58,000 | 470,000 |

Large-catalog scenarios explicitly measure empty and narrow prefixes, `dbo.` completion, cross-schema completion, result limiting/ranking, metadata indexing, metadata transfer, and response construction.

Metadata benchmarks separate query execution, row mapping, indexing, publication, worker transfer, and time to first useful versus fully enriched results.

External comparison lanes measure ScriptDOM and SqlParser as full-reparse baselines. Worker results always report both wall-clock and worker-internal time. Correctness gates run before performance results are accepted.

## Delivery milestones

1. Package, architecture rules, contracts, worker shells, observability, and benchmark scaffolding.
2. Null/in-memory metadata providers and shared provider/runtime contract tests.
3. Extension-side `dev/query` adapter and portable simple-query adapter.
4. Lossless tokenizer, minimal Lezer grammar, and incremental/full equivalence.
5. Typed syntax facade and cursor-context extraction.
6. Non-incremental binder with scopes, aliases, CTEs, local declarations, and metadata resolution.
7. Completion, hover, definition, diagnostics, and formatting foundations.
8. Incremental semantic units and metadata dependency invalidation.
9. Remaining editor features and systematic T-SQL grammar expansion.
10. Extension integration, production performance gates, and staged replacement of the legacy language service.

## Scaffolding acceptance criteria

- The package builds for Node and browser targets.
- There are no SaralSQL or Langium dependencies.
- Architecture tests enforce layer boundaries.
- Core DTOs do not import VS Code or database libraries.
- Node, browser, and in-process runtimes share a versioned protocol.
- Metadata adapter seams compile without requiring a live database.
- Stats and formatting are represented in the initial contracts.
- Benchmark smoke runners use deterministic generators.
- No credentials, generated giant corpora, or local result files are committed.
