# Azure, SQL DW, Fabric, and SQLCMD first-class readiness runbook

Use this runbook to make Azure SQL Database, Azure SQL Managed Instance, Azure Synapse dedicated
SQL pools (formerly SQL DW), Fabric Data Warehouse, and SQLCMD first-class language-service
targets. Continue until every required milestone and the final release gate are complete. Do not
interpret an existing grammar rule or one passing example as first-class support.

This runbook complements
[`LANGUAGE_SERVICE_COMPLETION_RUNBOOK.md`](LANGUAGE_SERVICE_COMPLETION_RUNBOOK.md). That runbook
owns general language-feature quality; this one owns engine detection, platform availability,
dialect-specific syntax and semantics, SQLCMD projection, and dialect-aware editor behavior.
Formatting is not a release gate here.

## Autonomous completion mandate

**Do not stop after completing a batch, a milestone, a convenient subset, or the currently familiar
work. Continue directly to the next unchecked item until the final release gate in this runbook is
fully satisfied.** Do not return merely to ask which area to take next, present a menu of remaining
work, or hand back unfinished items because they require a different layer, grammar generation,
metadata contracts, integration tests, or performance work. Those are expected parts of the task.

An agent may pause only when one of these conditions is true:

1. Every milestone and final-gate checkbox is complete with recorded, independently reviewable
   evidence.
2. Continuing requires authority the agent does not have, unavailable external infrastructure, or a
   product decision that materially changes the stated scope. The agent must record the exact
   blocker, commands and evidence, continue every other unblocked item, and stop only if all
   remaining work is blocked.
3. A correctness, security, licensing, or destructive-action risk cannot be resolved from the
   repository and references. Record the risk precisely; do not guess or silently weaken the gate.

Time, effort, grammar-generation duration, the number of remaining cases, an unsuccessful first
approach, or a test failure are not stopping conditions. Diagnose them, minimize the reproduction,
try the next sound approach, and continue. If context is compacted or execution is resumed by
another agent, read this runbook and the progress ledger, claim the next unblocked item, and keep
going without restarting completed work.

## Scope and terminology

The required profiles are:

| Profile                      | Meaning                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `sql-server`                 | Boxed SQL Server; retained as the common-language control.                     |
| `azure-sql-database`         | Azure SQL Database, including elastic pools and database copies.               |
| `azure-sql-managed-instance` | Azure SQL Managed Instance; do not treat it as Azure SQL Database.             |
| `azure-synapse-dedicated`    | Azure Synapse dedicated SQL pool, including the product formerly named SQL DW. |
| `fabric-warehouse`           | Microsoft Fabric Data Warehouse / Fabric DW.                                   |
| `unknown`                    | The host has not authoritatively identified the engine yet.                    |

Azure Synapse serverless SQL pools are not silently included in `azure-synapse-dedicated`. Add a
separate profile and inventory before claiming serverless support. Other engines and compatibility
levels remain outside this runbook unless explicitly added to the scope table.

SQLCMD is a document/execution-mode layer, not an engine flavor. A SQLCMD document may contain
regions associated with different connections because of `:connect`.

## What “first-class” means

A profile is first-class only when all of the following are true:

- The extension derives it from the connected server and publishes it as part of the immutable
  document/runtime snapshot. No feature silently uses the default SQL Server profile.
- All inventoried valid constructs produce structurally correct trees with zero raw recovery nodes.
- Unsupported platform/version combinations parse structurally and receive a deliberate
  availability diagnostic, rather than a generic syntax error.
- Platform-specific negative cases remain invalid; broad grammar alternatives do not accept nearby
  misspellings or illegal option combinations.
- Binding, diagnostics, completion, hover, signature help, semantic coloring, and definitions use
  the same profile, syntax snapshot, semantic snapshot, and pinned metadata generation.
- Metadata loading is permission-safe, lazy, cancellable, and responsive on very large catalogs.
- SQLCMD directives, variables, includes, source mapping, and connection regions behave correctly
  in both full and incremental updates.
- Offline, integration, extension, corpus, and performance gates below pass with recorded evidence.

Partial grammar support, selective profile checks, or successful execution on one server is not
first-class support.

## Read before editing

Read the relevant files completely before changing a layer:

1. [`../../README.md`](../../README.md) for package boundaries, snapshot ownership, workers, and
   metadata rules.
2. [`LANGUAGE_SERVICE_COMPLETION_RUNBOOK.md`](LANGUAGE_SERVICE_COMPLETION_RUNBOOK.md) for the
   grammar work loop, generator hazards, shared feature rules, and commands.
3. [`../../src/syntax/contracts.ts`](../../src/syntax/contracts.ts),
   [`../../src/syntax/lezer/lezerSyntaxService.ts`](../../src/syntax/lezer/lezerSyntaxService.ts),
   and [`../../src/syntax/lezer/grammar/tsql.grammar`](../../src/syntax/lezer/grammar/tsql.grammar)
   before profile, availability, or grammar changes.
4. [`../../src/common/builtInRegistry.ts`](../../src/common/builtInRegistry.ts) before changing
   versioned keywords, functions, types, or signatures.
5. [`../../src/metadata/contracts.ts`](../../src/metadata/contracts.ts), every provider under
   `../../src/metadata`, and the metadata contract tests before changing engine or catalog facts.
6. [`../../src/semantics/catalogSemanticBinder.ts`](../../src/semantics/catalogSemanticBinder.ts),
   [`../../src/semantics/tsqlSemanticDiagnostics.ts`](../../src/semantics/tsqlSemanticDiagnostics.ts),
   and [`../../src/features/tsqlLanguageFeatureService.ts`](../../src/features/tsqlLanguageFeatureService.ts)
   before changing dialect-aware binding or presentation.
7. [`../../../../extensions/mssql/src/languageservice/preview/previewLanguageService.ts`](../../../../extensions/mssql/src/languageservice/preview/previewLanguageService.ts)
   and
   [`../../../../extensions/mssql/src/languageservice/preview/simpleQueryMetadata.ts`](../../../../extensions/mssql/src/languageservice/preview/simpleQueryMetadata.ts)
   before extension profile wiring.
8. The local [ScriptDOM](https://github.com/microsoft/SqlScriptDOM) source and version/platform test
   manifests. In this workspace it is normally at `..\ScriptDOM` relative to the repository root.
   Use it to inventory public T-SQL behavior and independently author focused fixtures; do not copy
   implementation code or bulk-copy fixtures without reviewing licensing and provenance.

Read the nearest focused test before adding behavior. Search the full repository before inventing a
new profile, option list, diagnostic, or built-in registry.

## Non-negotiable architecture decisions

### Parse a structural superset; validate availability separately

Keep one shared T-SQL grammar wherever the syntax is structurally compatible. The parser must build
the same meaningful node for a construct that is valid on one profile but unavailable on another.
An availability validator then reports the profile/version restriction.

Do not make unavailable syntax disappear into recovery. Do not create separate copied grammars for
each engine. A separate parser entry point or bounded production is justified only when the
language structure is genuinely incompatible and focused conflict/performance evidence is recorded.

### Make the resolved profile part of snapshot identity

The engine profile is immutable and versioned. Syntax availability diagnostics, semantic binding,
and features must all consume the same resolved profile. A profile or compatibility change must
invalidate the affected products even when document text did not change.

While the profile is `unknown`, parse the structural superset and defer platform-unavailable
diagnostics. Never guess `sql-server` merely because metadata is loading.

### Prefer capabilities over raw server versions

Azure services do not always map cleanly to boxed SQL Server major versions. Centralize engine
edition mapping, compatibility interpretation, and feature capabilities. Do not scatter numeric
`engineEdition` comparisons or raw version parsing through grammar, binder, or feature files.

### Keep SQLCMD outside the SQL grammar

Build a lossless, host-neutral SQLCMD document layer before the T-SQL parser. It owns directives,
variables, include dependencies, projected SQL segments, bidirectional source maps, and connection
regions. The Lezer grammar must not grow ad hoc `:setvar`, `:r`, or shell-command rules.

The portable package must not open files, connect to servers, execute shell commands, or read
environment variables. Hosts supply resolvers and policies through contracts.

### Metadata remains asynchronous and pinned

Parsing and binding never execute database queries. Feature requests never block on a refresh.
Unknown or permission-limited metadata is not proof that an object or feature is absent. Catalog
requests must be narrow, indexed, generation-stamped, and safe for large catalogs.

## Agent coordination

Before editing, append a claim to
[`LANGUAGE_SERVICE_PROGRESS_LEDGER.md`](LANGUAGE_SERVICE_PROGRESS_LEDGER.md) with the prefix
`[dialect-readiness]`. Record owner, milestone, exact batch, paths, baseline commit, and expected
test. Append results; do not rewrite another agent’s evidence.

Agents may work in parallel only in these non-overlapping lanes:

| Lane                 | Primary ownership                                                    | Must coordinate before touching                        |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| Profile/runtime      | profile contracts, capability registry, runtime and extension wiring | metadata contracts, preview integration                |
| SQLCMD               | new SQLCMD document model, source maps, directive tests              | runtime document coordinator, worker protocol          |
| Grammar              | one dialect grammar family and its syntax tests                      | `tsql.grammar`, keyword specializer, generated grammar |
| Semantics/features   | one profile/context matrix                                           | shared binder, feature service, built-in registry      |
| Metadata             | one provider/section and contract tests                              | metadata contracts and extension adapters              |
| Benchmarks/inventory | reporters, manifests, generators, benchmark harnesses                | shared test manifest schemas                           |

Only one agent at a time may edit each of these hotspots:

- `src/syntax/contracts.ts`
- `src/syntax/lezer/grammar/tsql.grammar`
- `src/syntax/lezer/keywordSpecializer.ts`
- `src/metadata/contracts.ts`
- `src/common/builtInRegistry.ts`
- `src/semantics/catalogSemanticBinder.ts`
- `src/features/tsqlLanguageFeatureService.ts`
- `extensions/mssql/src/languageservice/preview/previewLanguageService.ts`

An agent reports a batch complete; only the designated integrator checks a milestone after reviewing
all evidence. Agents must not narrow scope, raise a baseline, suppress diagnostics, or redefine an
acceptance criterion to finish a checkbox.

## Baseline and recurring work loop

Before the first batch on a machine, record:

- branch, commit, dirty paths, Node version, OS, and CPU;
- package fast/all tests and corpus report;
- current results grouped by profile, not one aggregate;
- parser/binder/feature/metadata benchmarks;
- extension profile observed against each available live target;
- known unsupported, false-positive, and recovery-bearing cases.

From `packages/tsql-language-service` run:

```powershell
npm run build:typescript
npm run build:workers
node scripts/run-tests.mjs fast
node scripts/run-tests.mjs corpus
node scripts/report-tsql-corpus.mjs
node --expose-gc benchmarks/run.mjs --sizes 100k,1m,10m
node --expose-gc benchmarks/catalog-features.mjs
```

Do not add 100 MB to the ordinary gate. It remains an opt-in stress run.

For every implementation batch:

1. Claim one user-visible behavior and its paths in the ledger.
2. Add the failing focused test first. Include valid, invalid-neighbor, incomplete, wrong-profile,
   exact-range, and full/incremental cases where applicable.
3. Fix the lowest correct layer. Do not repair a parser problem with binder text matching or repair
   a metadata problem with a completion-only exception.
4. Generate grammar only when grammar inputs changed. Never generate grammar and compile TypeScript
   concurrently.
5. Run the focused test, `npm run build:typescript`, and `node scripts/run-tests.mjs fast`.
6. Run corpus tests for grammar/binder changes, metadata contract tests for provider changes, and
   extension integration tests for routing/profile changes.
7. Run the directly affected benchmark. Investigate a repeatable same-machine p50 or p95 regression
   above 10% before continuing.
8. Append exact evidence and limitations to the ledger. Do not check a parent milestone for a
   partial matrix.

Grammar regeneration command:

```powershell
node --max-old-space-size=8192 scripts/build-grammar.mjs
```

Allow at least 30 minutes. A generator run is not a reason to combine unrelated grammar families.

## Milestone 0 — reproducible dialect inventory and report

- [ ] Add one machine-readable manifest for Azure SQL Database, Managed Instance, Synapse dedicated,
      and Fabric Warehouse syntax scenarios.
- [ ] Inventory relevant ScriptDOM engine/version tests by statement family and independently author
      minimized positive and negative cases in this package.
- [ ] Classify every existing dialect-related test and corpus file by profile, compatibility,
      statement family, and expected result.
- [ ] Add an automated readiness reporter that publishes totals for structural parse, unexpected
      recovery, availability diagnostics, semantic diagnostics, completion, hover/signature,
      coloring, and definition coverage per profile.
- [ ] Record the starting extension profile behavior and current false-positive/false-negative list.

Manifest entries must include:

- stable scenario ID;
- engine profile and compatibility level;
- feature ID and statement family;
- valid, invalid, unsupported-profile, or incomplete classification;
- expected structured node(s), diagnostics and exact spans;
- editor offsets for completion/hover/signature/definition when relevant;
- source-reference note and independent-fixture provenance;
- minimum metadata sections required;
- full/incremental expectation.

Acceptance criteria:

- Every relevant ScriptDOM Azure, SQL DW/Synapse, and Fabric test family is mapped to a scenario,
  an explicit unsupported/out-of-scope decision, or a documented duplicate.
- The report distinguishes missing evidence, unsupported behavior, failing behavior, and passing
  behavior. Missing tests never count as passing.
- Totals are stable and runnable from a documented command without a live server.
- Existing partial support is measured rather than assumed from grammar text.

## Milestone 1 — authoritative engine profile and extension wiring

- [ ] Replace the ambiguous flavor model with the profiles in this runbook, including `unknown`.
- [ ] Add a central, exhaustively tested engine-edition/environment-to-profile resolver.
- [ ] Add a versioned feature-capability object derived from profile, compatibility, server facts,
      and preview policy.
- [ ] Include profile/capability generation in syntax, semantic, runtime, worker, and feature snapshot
      identity.
- [ ] Pass the connected editor’s `engineEdition`, `serverVersion`, and `compatibilityLevel` from
      metadata into the runtime; remove the unconditional default-profile construction path.
- [ ] Reprofile and republish open documents after connection, database, compatibility, or metadata
      environment changes without reparsing unchanged text unnecessarily.
- [ ] Show resolved profile, source facts, capability generation, and readiness in stats-for-nerds.

Required tests:

- resolver table tests for every known engine edition and unknown/future values;
- Azure SQL Database versus Managed Instance distinction;
- Synapse dedicated and Fabric detection;
- disconnected/loading/permission-limited environment behavior;
- connection and database switches with unchanged document text;
- stale environment results arriving after a newer connection/profile;
- in-process, Node worker, and browser worker profile equivalence;
- extension preview routing against mocked metadata environments.

Acceptance criteria:

- No production path constructs `LezerSyntaxService` or the runtime with an implicit SQL Server
  profile for a connected document.
- `unknown` produces no false platform-unavailable diagnostics.
- A profile change updates availability diagnostics and feature results while preserving valid
  reusable syntax work.
- All asynchronous publications reject stale document, metadata, connection, and profile versions.
- Stats identify exactly which profile and generation produced the visible result.

## Milestone 2 — one platform feature registry

- [ ] Create stable feature IDs for all versioned/platform-specific statements, clauses, options,
      built-ins, types, signatures, and metadata object kinds.
- [ ] Move scattered platform/version checks into one registry or generated registry family.
- [ ] Map structured syntax nodes to feature IDs without matching arbitrary source text.
- [ ] Emit a dedicated availability diagnostic with feature, profile, and required platform/version.
- [ ] Make completion, hover, signature help, and coloring consult the same registry.
- [ ] Add an audit that fails when a platform-gated grammar node lacks a registry entry or a registry
      feature lacks evidence.

Each registry entry must describe, where applicable:

- supported profiles;
- minimum/maximum compatibility;
- preview requirement;
- canonical display name and documentation key;
- grammar node(s) and built-in/signature entries;
- semantic or metadata capabilities required;
- deliberate diagnostic code and message template.

Acceptance criteria:

- Supported syntax parses identically across profiles; only availability results differ.
- Every unsupported-profile scenario receives one deliberate availability diagnostic and no generic
  syntax diagnostic caused solely by the profile.
- Unknown profiles defer availability decisions.
- Completion never suggests a known unavailable feature; hover explains availability for a feature
  present in source.
- No numeric engine-edition comparisons exist outside the profile resolver and its tests.
- Registry lookup adds no repeatable benchmark regression above 5% by itself.

## Milestone 3 — first-class SQLCMD document model

- [ ] Add a portable SQLCMD scanner and immutable `SqlCmdDocumentSnapshot` outside the Lezer grammar.
- [ ] Model directives, arguments, variables, projected SQL segments, source documents, connection
      regions, diagnostics, and include dependencies.
- [ ] Implement bidirectional UTF-16 source maps from projected SQL back to original root/include
      files, including substitutions whose lengths differ.
- [ ] Support `GO` and `GO n`, `:setvar`, `$(name)`, escaped variable text, `:r`, `:connect`,
      `:on error`, `:out`, `:error`, `:list`, `:reset`, and `!!` as explicit constructs.
- [ ] Define host contracts for include loading, variable seeds, connection lookup, and command
      policy. Supply null and in-memory implementations for tests.
- [ ] Make updates incremental. Recompute only the changed directive/SQL segment and downstream
      state affected by changed variables, includes, or connections.
- [ ] Add SQLCMD completion for directive names, directive arguments, and known variables.
- [ ] Route syntax/semantic ranges, hover, definitions, coloring, and diagnostics through source maps.

Safety requirements:

- The portable service never executes `!!`, connects, reads a file, or reads process environment.
- Includes have cancellation, cycle detection, depth/count/size limits, stable URI identity, and
  permission-aware failures.
- Secrets and variable values are excluded from logs, statistics, telemetry, diagnostic messages,
  and cache keys that can be surfaced.
- Unresolved variables and unavailable includes are reported as SQLCMD diagnostics; they must not
  become phantom SQL object-not-found diagnostics.
- `:connect` creates a new region context; it does not mutate previous regions.

Acceptance criteria:

- Every directive has positive, malformed, case-insensitive, whitespace, quoted-argument, Unicode,
  CRLF/LF, and incomplete-typing tests.
- Nested includes and variable precedence have reviewed deterministic semantics.
- Full and incremental snapshots produce identical directives, projected text, source maps,
  connection regions, and diagnostics for the same final state.
- Exact LSP ranges map correctly into root and included documents.
- SQL-only files pay no material SQLCMD overhead: same-machine parse p50/p95 regression is below 5%.
- SQLCMD benchmarks cover 100 KB, 1 MB, and 10 MB files, variable edits, include fan-out, and edits
  before/inside/after a connection boundary.

## Milestone 4 — Azure SQL Database and Managed Instance

- [ ] Complete and inventory `CREATE/ALTER/DROP DATABASE`, database copy, service objective, edition,
      elastic pool, max size, redundancy, and Azure database-option matrices.
- [ ] Model database-scoped configuration and Azure-specific security/identity/external-access forms.
- [ ] Inventory and implement Azure-specific built-ins, types, options, and compatibility gates.
- [ ] Encode Azure SQL Database restrictions for server-scoped, cross-database, backup/restore,
      availability, file/filegroup, and other unsupported boxed-server constructs.
- [ ] Keep Managed Instance capability differences explicit; do not inherit Azure SQL Database
      restrictions by name.
- [ ] Complete Azure-aware binding and metadata identity for databases, schemas, contained users,
      external objects, and permitted multipart references.
- [ ] Complete dialect-aware completion, hover, signature, coloring, and catalog definitions.

Required negative-neighbor coverage includes misspelled service options, invalid option nesting,
illegal profile combinations, unsupported server-level statements, and incomplete copy/service-tier
clauses. Valid syntax unavailable on the selected Azure profile must remain structurally parsed.

Acceptance criteria:

- The Azure manifest has no missing or unexpected-recovery scenarios.
- Azure SQL Database and Managed Instance disagree exactly where the capability matrix says they do.
- Cross-schema and supported cross-database completion edits produce executable qualified names.
- Catalog incompleteness or permission limits never create false invalid-object or unsupported
  diagnostics.
- The connected extension chooses the correct profile and republishes after a database/profile
  change.
- Azure-specific completion, hover, signature, coloring, and definition scenario matrices pass.

## Milestone 5 — Azure Synapse dedicated SQL pool / SQL DW

- [ ] Complete CTAS and CETAS, including distribution, heap/columnstore/index, partition, and option
      combinations.
- [ ] Complete `COPY INTO` file lists, mappings, credentials, rejection handling, parsers, formats,
      and option validation.
- [ ] Complete external tables, data sources, file formats, credentials, and related lifecycle DDL.
- [ ] Complete `HASH`, `ROUND_ROBIN`, and `REPLICATE` distribution semantics and metadata.
- [ ] Complete materialized views and supported index/table option matrices.
- [ ] Add workload groups, workload classifiers, resource classes, and their option/value validation.
- [ ] Add `PREDICT` and other dedicated-pool query/table-source constructs identified by the inventory.
- [ ] Encode dedicated-pool DML, transaction, constraint, query-hint, and unsupported-statement
      restrictions through deliberate availability/semantic diagnostics.
- [ ] Complete Synapse catalog kinds, binding, completion, hover, signature, coloring, and definitions.

Acceptance criteria:

- All dedicated SQL pool/SQL DW inventory scenarios have executable evidence and no unexpected
  recovery.
- Illegal distribution, index, workload, copy, and external-object option combinations have precise
  negative tests; generic identifier/option catch-alls are not accepted as completion.
- `COPY INTO`, CTAS/CETAS, external-object, workload, and `PREDICT` incomplete states retain useful
  completion without exporting phantom objects.
- Distribution and external metadata are loaded only when required and do not block feature calls.
- Large-catalog feature benchmarks pass with Synapse object kinds enabled.

## Milestone 6 — Fabric Data Warehouse

- [ ] Build a reviewed Fabric-specific inventory from ScriptDOM’s Fabric DW parser/tests and current
      public feature requirements.
- [ ] Complete Fabric query extensions such as applicable `GROUP BY ALL` / `ORDER BY ALL`, nested
      query forms, and profile-specific scalar/table functions.
- [ ] Complete clone-table, Fabric table/identity behavior, external data source/table, and ALTER
      table clustering constructs.
- [ ] Complete external functions, external API invocation, AI statements/functions, and their
      option/signature validation where included in the inventory.
- [ ] Model Fabric database/schema/object kinds and platform restrictions independently from Synapse.
- [ ] Complete Fabric binding, completion, hover, signature, coloring, and definitions.

Acceptance criteria:

- Fabric is not implemented as a synonym for Synapse; profile-difference tests prove the boundary.
- Every inventoried Fabric-only node has a registry entry, availability tests on other profiles,
  malformed/incomplete tests, and language-feature evidence.
- Unknown or rolling-preview Fabric capabilities remain deferred unless the environment confirms
  them; they do not become hard false diagnostics.
- The Fabric corpus and catalog-feature benchmark pass without unexpected recovery or a repeatable
  regression above 10%.

## Milestone 7 — dialect-aware semantics and editor features

- [ ] Add platform object kinds, built-ins, types, table sources, options, and principals to binding
      without leaking host metadata models into the package.
- [ ] Make semantic diagnostics require both a structured node and authoritative capability/metadata
      facts.
- [ ] Complete completion matrices for statement, clause, option, database, schema, object, column,
      routine, type, principal, SQLCMD variable, and directive contexts per profile.
- [ ] Preserve user/default-schema objects before system objects and platform-appropriate qualification
      for cross-schema/cross-database edits.
- [ ] Complete hover/signature content with engine and compatibility availability.
- [ ] Color platform-specific keywords, built-ins, objects, and roles using the shared snapshot.
- [ ] Route catalog definitions through the existing host-neutral scripting/definition contract for
      every scriptable platform object.
- [ ] Ensure references, rename, symbols, folding, and selection ranges remain structurally correct
      for newly introduced nodes even though they are not the primary breadth target here.

Acceptance criteria:

- A generated cross-product test matrix covers every supported profile, context, qualification
  shape, quoted/unquoted form, empty/prefix state, metadata state, and wrong-profile case.
- Feature requests perform zero parses and no broad synchronous metadata refresh.
- Completion results are deterministic, deduplicated, correctly qualified, and marked incomplete
  when capped or awaiting metadata.
- Unsupported features are excluded from completion; existing unsupported source receives one
  availability explanation in diagnostics/hover.
- Definitions and hover reject stale document/profile/metadata generations.
- Coloring full/range/delta outputs agree after profile and metadata changes.

## Milestone 8 — provider, worker, integration, and performance hardening

- [ ] Extend the metadata provider contract only for facts genuinely required by the dialect
      matrices. Update null, in-memory, simple-query, dev/query, and extension adapters together.
- [ ] Run one shared metadata contract suite against every provider and profile.
- [ ] Add staged/lazy loading and indexed search for platform objects without enumerating all columns
      or definitions during completion.
- [ ] Make profile, SQLCMD, syntax, semantic, and feature snapshots transportable through Node and
      browser workers without connection objects or credentials.
- [ ] Add live integration suites for every available engine and a deterministic mock/server fixture
      for engines unavailable in CI.
- [ ] Add extension tests for connection changes, profile changes, stale metadata, cancellation,
      SQLCMD includes, and cross-database navigation.
- [ ] Extend benchmarks for profile resolution, availability validation, SQLCMD projection, dialect
      parsing/binding, metadata refresh, large-catalog completion, hover, and definitions.

Performance scenarios must include:

- 100 KB, 1 MB, and 10 MB valid, malformed, DML, DDL, analytical, and administrative SQL;
- cold/warm full parse and edits at start/middle/end;
- profile-only and compatibility-only rebinding with unchanged text;
- SQLCMD with variables, includes, `GO n`, and multiple connection regions;
- at least 60,000 objects and 500,000 columns, skewed heavily into one schema;
- empty/prefix/qualified cross-schema/cross-database completion;
- metadata initial load, staged publication, targeted hydration, refresh, stale failure, and reconnect;
- in-process, Node worker, and browser worker execution.

Acceptance criteria:

- Correctness checks pass before benchmark measurements are accepted.
- Same-machine p50 and p95 regressions above 10% are explained and approved; transport/profile
  overhead has its own reported lane.
- Ordinary completion/hover performs no catalog-wide column load and returns useful local/grammar
  results while metadata is incomplete.
- Cancellation detaches callers without poisoning shared refresh, include, scripting, or hydration
  work.
- No credential, SQLCMD secret, connection object, or unrestricted resolver crosses a worker
  boundary.
- Extension stats expose parse, bind, availability, SQLCMD projection, metadata, and feature timing
  plus the profile/generation that produced them.

## Final release gate

The designated integrator may mark this runbook complete only when:

- [ ] Milestones 0–8 are independently reviewed and checked with ledger evidence.
- [ ] Every scoped profile has zero missing required inventory scenarios and zero unexpected raw
      recovery on valid/profile-gated SQL.
- [ ] Every unsupported-profile scenario has one deliberate availability diagnostic and a correct
      structural tree.
- [ ] SQLCMD full/incremental/source-map equivalence is green, including nested includes and
      connection regions.
- [ ] Offline package, corpus, metadata contract, worker, integration, and extension suites pass.
- [ ] Completion, hover, signature, coloring, diagnostics, and definitions have dialect-specific
      evidence and consume the shared snapshot.
- [ ] Live smoke tests pass for every available target; unavailable services have deterministic
      provider/fixture evidence and are explicitly identified.
- [ ] The readiness report and stats view identify the active profile and contain no “missing” or
      unreviewed categories.
- [ ] 100 KB, 1 MB, and 10 MB parser/binder/SQLCMD benchmarks and the large-catalog feature/metadata
      benchmarks have no unexplained same-machine regression above 10%.
- [ ] Preview mode does not fall back silently to the old language service for the features claimed
      here.

The final handoff must include the readiness report, exact test commands and counts, corpus results,
benchmark JSON and machine details, live targets exercised, known service limitations, and links to
the ledger entries. A narrative claim without executable evidence does not satisfy this gate.

## Ledger templates

Append these entries to
[`LANGUAGE_SERVICE_PROGRESS_LEDGER.md`](LANGUAGE_SERVICE_PROGRESS_LEDGER.md); never replace prior
measurements.

### Dialect baseline

- Tag: `[dialect-readiness]`
- Owner / date / branch / commit:
- Worktree and machine:
- Profile(s) and compatibility level(s):
- Package / corpus / worker / integration / extension results:
- Readiness report totals by profile:
- Parser / binder / SQLCMD / catalog benchmark commands and results:
- Known false positives, false negatives, recovery, or missing evidence:

### Dialect batch

- Tag/status: `[dialect-readiness] [~]` or `[dialect-readiness] [x]`
- Owner / milestone / scenario IDs:
- User-visible behavior and expected result:
- Claimed files/hotspots:
- Source-reference evidence reviewed:
- Focused test added before implementation:
- Focused / fast / corpus / contract / integration results:
- Full/incremental and wrong-profile results:
- Benchmark before/after:
- Remaining limitation and next unclaimed batch:

### Milestone review

- Tag: `[dialect-readiness] [review]`
- Integrator / milestone / commit:
- Inventory denominator and missing count:
- Unexpected recovery and diagnostic count:
- Feature matrix status:
- Test and benchmark evidence:
- Rejected or follow-up batches:
- Decision: open / accepted
