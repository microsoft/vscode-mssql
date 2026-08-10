# Incremental parser benchmark

This standalone harness compares three distinct workloads over the same generated T-SQL text:

1. `IncrementalBatchParser` creation and updates using reusable GO-separated, relative-offset batch
   artifacts.
2. Whole-document Saral parsing (`Lexer` plus `Parser`).
3. Whole-document Saral analysis (`analyze`), which additionally builds scopes, diagnostics,
   lineage, and column resolution.

It is intentionally kept separate from tests. Build the package first because the harness imports
JavaScript from `../dist` rather than executing TypeScript source:

```powershell
npx tsc -p packages/tsql-language-service/tsconfig.json
node --expose-gc packages/tsql-language-service/benchmarks/parser-benchmark.mjs --quick
```

The equivalent package command is `npm run benchmark -- --quick` from this package directory.

The full default run generates 1,000 logical statements as both 200 small GO-separated batches and
one huge batch, then collects 30 measured samples after five warmups. Quick mode uses 36 statements,
five samples, and one warmup.

## Workloads and interpretation

The harness reports warmed create lanes plus edits at the beginning, middle, and end. It also tests a
malformed expression while typing and a GO-boundary change: removing a middle GO from the many-batch
corpus and adding one to the huge-batch corpus.

Incremental results have two lanes:

- `batch-relative` measures update/create while retaining reusable relative-offset parser products.
- `absolute-ast-compatibility` also calls `parseResult()` to materialize a conventional absolute AST.

Whole parsing and whole analysis are always labeled `full-reanalysis`. Do not compare batch-relative
time to whole analysis as if they performed identical semantic work. The useful comparisons are:

- incremental create+materialize versus whole parse;
- incremental update+materialize versus whole parse after the same edit;
- batch-relative update time and reuse rates as the cost available to batch-aware consumers;
- whole analysis as the current cost floor when semantic analysis cannot yet reuse batch products.

Every base document and edit is checked outside the timed samples. A canonical SHA-256 checksum of
the incremental materialized AST/issues must equal both whole parse and whole analysis parse output,
or the run fails. Reuse reports include declared statistics and parser-artifact identity counts.

“First observed” timings are single invocations after module loading in one shared process; they are
not isolated process-start measurements and may be order/JIT sensitive. Percentile tables are the
primary comparison. With `--expose-gc`, the JSON also includes forced-GC retained-heap deltas while
one result remains reachable. Treat small or negative memory deltas as noise, not as allocated-size
measurements.

## Options

```text
--quick
--batches <positive integer>
--statements-per-batch <positive integer>
--samples <positive integer>
--warmups <non-negative integer>
--memory-samples <positive integer>
--format table|json|both
--json <output file>
```

Examples:

```powershell
# Human-readable full run
node --expose-gc packages/tsql-language-service/benchmarks/parser-benchmark.mjs

# Custom size with table output plus a machine-readable artifact
node --expose-gc packages/tsql-language-service/benchmarks/parser-benchmark.mjs `
  --batches 400 --statements-per-batch 4 --samples 50 `
  --format table --json parser-benchmark.json

# JSON on stdout for automation
node packages/tsql-language-service/benchmarks/parser-benchmark.mjs --quick --format json
```

Run on an otherwise idle machine, pin the same Node version/power policy for comparisons, and compare
JSON with matching configuration. Source bytes, statement count, batch count, runtime metadata,
percentiles, reuse, memory qualification, and correctness checksums are included in the report.

## Exact-size large files

The large-file profile uses deterministic SQL corpora of exactly 1 MiB (1,048,576 bytes), 10 MiB
(10,485,760 bytes), and 50 MiB (52,428,800 bytes). The generated `.sql` files and their manifest are
written to the ignored `benchmarks/generated/` directory, so 61 MiB of derived data is never checked
into Git.

Generate the files without running a benchmark:

```powershell
npm run benchmark:generate-large
```

Run all three sizes with an 8 GiB Node heap:

```powershell
npm run benchmark:large
```

The large profile measures batch-relative creation and a fixed-width middle-batch edit, incremental
materialization to a conventional absolute AST, and whole parsing of the original and edited files.
Before timing each size, a streaming canonical SHA-256 digest verifies that the incrementally
materialized AST and issues exactly match whole parsing. The report also includes batch/character
reuse. Whole semantic analysis is omitted by default because retaining multiple 50 MiB analysis
graphs can dominate memory; enable it explicitly with `--include-analysis`.

Large-profile options are:

```text
--quick                         # 1 MiB, one sample, no warmup
--sizes 1,10,50                 # any comma-separated subset
--samples <positive integer>
--warmups <non-negative integer>
--include-analysis
--format table|json|both
--json <output file>
```

Examples:

```powershell
# Fast validation of the full correctness/reuse path
npm run benchmark:large -- --quick

# Benchmark only 10 MiB and retain JSON results
npm run benchmark:large -- --sizes 10 --samples 5 --json large-10mib.json
```

These are MiB sizes (powers of 1024), despite the colloquial “MB” shorthand. Generation and file I/O
happen before timed parser samples. The files contain complete GO-separated T-SQL batches followed
only by harmless whitespace padding to reach the exact byte count.

### Qualified large-file observation

One post-build validation on this development workspace (Node v26.3.0, one sample, no warmup)
completed all three canonical checksum and reuse assertions:

| Size   |  Batches reused | Incremental create | Middle-batch update | Update + absolute AST | Whole edited parse |
| ------ | --------------: | -----------------: | ------------------: | --------------------: | -----------------: |
| 1 MiB  |       822 / 823 |          327.91 ms |           110.62 ms |             162.09 ms |          182.73 ms |
| 10 MiB |   8,224 / 8,225 |        3,093.10 ms |         1,047.49 ms |           1,559.06 ms |        1,734.62 ms |
| 50 MiB | 41,120 / 41,121 |       13,810.35 ms |         8,489.54 ms |          14,729.66 ms |       11,631.28 ms |

These single-sample numbers validate scale and correctness, not a performance baseline. In
particular, materializing a complete absolute AST can cost more than a fresh whole parse at 50 MiB;
batch-aware consumers obtain the useful reuse path before that compatibility materialization.

## Integrated analysis-engine snapshots

`analysis-engine-benchmark.mjs` measures the public `SaralSqlAnalysisEngine` snapshot lifecycle,
not the raw parser. Each sample includes the adapter's analysis, token/scope/symbol projection,
document-local schema handling, catalog checks, diagnostics, and feature-model construction.

It runs 1, 10, and 50 MiB exact-size generated corpora through two metadata lanes:

- `metadata-open` supplies representative object metadata without closed-world missing-object errors.
- `closed-representative-catalog` uses the same representative tables and procedure as a closed
  catalog, exercising catalog-backed diagnostics and enrichments.

For each lane, it measures snapshot creation and fixed-width edits at the beginning, middle, and
end of a GO-separated corpus. Before timing, every create/update snapshot is canonically hashed
against a fresh `SaralSqlAnalysisEngine` snapshot for the same text and catalog. Fixed-width edits
also assert that the batch count is unchanged and at least one batch is reused. JSON reports p50,
p95, mean, retained-heap samples (with `--expose-gc`), reuse counts/percentages, and correctness
checksums.

Build first, then start with the quick multi-batch smoke validation. It trims the generated source
to roughly 16 KiB so the full create/update/canonical-check sequence completes in a practical time:

```powershell
npm run build
node --expose-gc benchmarks/analysis-engine-benchmark.mjs --quick
```

The full profile is intentionally expensive because it builds complete editor snapshots and fresh
canonical comparison snapshots for both metadata lanes. The optimized adapter currently completes
a 1 MiB snapshot in roughly 1.7–2.4 seconds on the reference development machine (versus roughly
66 seconds before the linear-scaling fixes); use matching runtime/hardware for comparisons. Use a
large heap and an otherwise idle machine:

```powershell
node --max-old-space-size=8192 --expose-gc benchmarks/analysis-engine-benchmark.mjs `
  --sizes 1,10,50 --samples 3 --warmups 1 --memory-samples 1 --format both `
  --json analysis-engine-benchmark.json
```

Options:

```text
--quick
--sizes 1,10,50                 # any comma-separated subset
--samples <positive integer>
--warmups <non-negative integer>
--memory-samples <non-negative integer>
--format table|json|both
--json <output file>
```

The benchmark is an observability harness, not a CI performance gate. Compare matching Node
versions, corpus sizes, metadata lanes, and sample settings; percentile results are more reliable
than one-off timings.

### Qualified local smoke observation

One post-build run on this development workspace (Node v26.3.0, `--quick --memory-samples 1`)
used a 15,300-byte, 13-batch corpus with one timing sample. The open metadata lane reported
49.73 ms create and 27.29–42.84 ms updates; the representative closed-catalog lane reported
56.66 ms create and 33.62–41.26 ms updates. Every fixed-width update reused 12/13 batches, the
fresh-engine canonical checksums matched, and forced-GC retained-heap samples were 1.82–2.08 MiB.
These are only a local smoke observation—not a baseline, regression threshold, or a prediction for
the 1/10/50 MiB runs. The generated corpora now assert exact UTF-8 byte round trips, and all three
benchmark edits assert that they preserve byte size before timing.
