# Benchmarks

Benchmarks consume the built package and generate deterministic SQL and metadata in memory. They are
separate from correctness tests, and generated JSON stays under ignored `benchmarks/generated/`.

## Parser lifecycle

`run.mjs` measures first and warm full parse, full reparse, incremental start/middle/end edits,
throughput, diagnostics, chunk reuse, Node worker round trips, and memory. Incremental trees are
compared with fresh trees outside timed regions.

```powershell
npm run benchmark:smoke
npm run benchmark -- --sizes 100k,1m,10m
```

The 100 MiB workload is an explicit soak lane:

```powershell
npm run benchmark -- --sizes 100m
```

## Full language-service lifecycle

`language-service.mjs` measures:

- runtime open, edit, metadata refresh plus rebind, and metadata-only rebind;
- first completion, hover, diagnostics, definition, signature, and coloring after each lifecycle
  state;
- warm feature requests separately;
- source-coordinate mapping overhead;
- in-process extension-host open, edit, and completion heartbeat delay;
- Node worker open, edit, completion transfer time, and host heartbeat delay;
- shared-catalog versus per-document-catalog retained heap;
- one-large-batch, many-batch, malformed, Unicode, and realistic generated corpora.

Lanes are interleaved in a deterministic shuffled order. Reports include warmups, samples, p50,
p95, mean, standard deviation, min/max, commit, executable-source worktree fingerprint, runtime,
machine, corpus, catalog, and seed. The fingerprint covers `src`, benchmark/build scripts, and build
configuration; report documentation is excluded so recording a result cannot invalidate it. Feature
and incremental/fresh correctness checks run after timing.

```powershell
npm run benchmark:language-service -- --samples 10 --warmups 3 `
  --document-kb 64 --catalog-objects 57885 `
  --corpora one-large-batch,many-batches,malformed,unicode,realistic `
  --json benchmarks/generated/language-service.json
```

Use `--skip-worker` or `--skip-memory` only for local diagnosis; a release report includes both.
Retained-memory measurement requires `--expose-gc`, which the npm command supplies.

### Audit-remediation reference run

The 2026-08-20 reference run used base commit
`e6a95b967cdedfca564a16ab484b8830484936de`, dirty executable-source fingerprint
`040b78eedeb1ad74f1f932df886729f735af2d05067d0b0b869be239a3fca890`, Node 24.15.0,
Windows x64, an AMD EPYC 7763 allocation with 16 logical CPUs, 57,885 catalog objects, 8 KiB
documents, five samples, two warmups, and seed `0x5eed2026`.

Representative p50/p95 milliseconds:

| Lane                                  |     p50 |     p95 |
| ------------------------------------- | ------: | ------: |
| One large batch: open                 |  56.663 |  57.546 |
| One large batch: edit                 |  55.424 |  65.873 |
| One large batch: metadata-only rebind |   7.459 |   8.281 |
| Many batches: open                    |  60.154 |  70.645 |
| Many batches: edit                    |  24.065 |  24.122 |
| Realistic: open                       |  62.619 |  70.724 |
| Realistic: edit                       |  26.175 |  26.462 |
| Realistic: first completion           |   5.935 |   5.987 |
| Realistic: warm completion            |   3.462 |   5.364 |
| Source-mapped completion wrapper      |  13.799 |  14.323 |
| Worker open                           | 336.599 | 339.178 |
| Worker edit                           |  38.427 |  39.097 |
| Worker completion                     |  13.929 |  14.187 |

The worker heartbeat p95 was 5.443 ms for open, 13.160 ms for edit, and 10.099 ms for completion.
Four documents retained 38.904 MiB with one shared catalog versus 120.142 MiB with per-document
catalogs, avoiding 81.238 MiB of duplication. All incremental/fresh checks matched.

## Large-catalog features

`catalog-features.mjs` uses a customer-scale shape with 57,885 objects and measures catalog indexing,
parse/bind, schema/object/column completion, cross-schema lookup, SELECT-star expansion, and INSERT
expansion. Detail rows remain lazy.

```powershell
npm run benchmark:features
```

## Semantic diagnostics

`semantic-diagnostics.mjs` isolates binder time after parsing and metadata pinning. It reports local,
resolved-catalog, and missing-object workloads.

```powershell
node benchmarks/semantic-diagnostics.mjs --statements 100 --warmups 10 --samples 40
```

## SQL Parser comparison

`compare-sqlparser.mjs` compares the TypeScript parser with the public
`Microsoft.SqlServer.Management.SqlParser` NuGet package using the same generated documents and
fixed-width edits. The npm command restores and builds the pinned .NET helper before running it, so
it does not require a separate SqlParser checkout.

```powershell
npm run benchmark:sqlparser -- --sizes 100k,1m,10m --samples 3 --warmups 1
```

The report records the loaded SqlParser assembly and informational versions. Use
`SQLPARSER_BENCHMARK_EXE` or `--sqlparser-exe` only to compare against an explicitly supplied local
build.

## Dialect and optional external comparisons

`dialect.mjs` measures profile-gated grammar workloads. Optional local comparison harnesses are
engineering tools and are not part of the package's public build, test, or readiness claims.

## Interpretation rules

- Compare only reports with matching commit, runtime, CPU, corpus, sizes, catalog count, warmups,
  samples, and seed.
- A parser result does not stand in for binding or editor-feature latency.
- A warm result does not stand in for first-hit latency.
- Worker wall time and worker-internal analysis time are separate costs.
- Process RSS is not retained-tree size; retained heap is reported only after forced GC.
- Never weaken or move correctness checks into timed regions to improve a number.
