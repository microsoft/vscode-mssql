# T-SQL language-service benchmarks

Benchmarks consume the built package and generate deterministic SQL and metadata in memory. Generated corpora and result artifacts are ignored.

The parser runner validates incremental/fresh tree equivalence and measures cold full parse, warm
full parse, full reparse, batch-incremental parse, and Node worker round trips. Edits are applied near
the start, middle, and end. Results also include throughput, diagnostics, reused batch chunks, and the
full-reparse/incremental speedup.

The runtime scans lossless SQL lexical states once and caches compact Lezer trees in approximately
16 KiB groups of `GO` batches. Unchanged chunks and their diagnostics are reused by identity. A file
without `GO` remains one chunk and is honestly reported as a full reparse until finer statement-level
reuse is implemented.

```powershell
npm run benchmark:smoke
npm run benchmark -- --sizes 5k,100k,1m,10m
```

Catalog/editor-feature performance is measured separately from parser throughput. The generated
catalog matches the reported customer shape (57,885 objects, including 36,119 `dbo` tables) and
measures catalog indexing, parse-and-bind, schema/object/column completion, cross-schema lookup,
`SELECT *` expansion, and smart `INSERT` expansion. Column details remain lazy, as they are in the
Simple Query and dev/query metadata adapters.

```powershell
npm run benchmark:features
```

The 100 MiB workload is an explicit manual soak lane:

```powershell
npm run benchmark -- --sizes 100m
```

Correctness checks accompany timings: every start/middle/end incremental result must have the same
normalized tree checksum as a fresh parse. The external ScriptDOM and SqlParser comparison lanes are
kept separate because ScriptDOM is always labeled full reparse and SqlParser is the diagnostic oracle.

## Grammar milestone baseline (2026-08-13)

This local Windows/Node 24 run measures the accepted query, DML, table/index DDL, view, synonym,
type, sequence, and session grammar. Each size uses a deterministic valid corpus with `GO` batch
boundaries. Times are single-run engineering guardrails, not statistically stable release numbers.

|    Size |   Cold full |   Warm full | Incremental start | Incremental middle | Incremental end | Reused chunks |
| ------: | ----------: | ----------: | ----------------: | -----------------: | --------------: | ------------: |
| 100 KiB |   127.77 ms |    81.20 ms |          32.96 ms |           18.51 ms |         5.83 ms |             6 |
|   1 MiB |   789.79 ms |   730.05 ms |          58.27 ms |           30.60 ms |        30.23 ms |            63 |
|  10 MiB | 7,182.11 ms | 7,679.31 ms |         186.33 ms |          168.26 ms |       173.82 ms |           638 |

All nine incremental edit lanes matched a fresh tree checksum and produced zero diagnostics. The
10 MiB middle worker lane measured 6,905.04 ms initial wall time and 219.04 ms edit wall time
(6,774.34 ms and 218.62 ms inside the worker). The 100 MiB soak was deliberately not run.

## Local SqlParser comparison

`compare-sqlparser.mjs` runs the TypeScript Lezer parser and Microsoft's local `SqlParser` source
over the same exact-size, deterministic, valid T-SQL files. Both engines report first-observed and
warmed whole-file parsing plus fixed-width valid edits near the start, middle, and end. The
TypeScript edit lane is labeled `go-batch-incremental`; SqlParser is measured both as
`full-reparse` via `Parser.Parse` and as `native-incremental` via `Parser.IncrementalParse`.

Build the sibling SqlParser assembly and the small benchmark host, then run the comparison:

```powershell
dotnet build ..\..\..\SqlParser\src\Microsoft\SqlServer\Management\SqlParser\Microsoft.SqlServer.Management.SqlParser.csproj -c Release -f net8.0
dotnet build benchmarks\dotnet\LocalSqlParserBenchmark.csproj -c Release
npm run benchmark:sqlparser -- --sizes 100k,1m,10m --samples 3 --warmups 1 `
  --json benchmarks\generated\sqlparser-comparison.json
```

Generated SQL and JSON stay under ignored `benchmarks/generated/`. Parser timings exclude file
generation and file I/O. Process startup is also outside the internal timing, while peak/current
working-set figures remain process-level observations rather than retained-tree sizes. Every
TypeScript incremental edit is checksum-checked against a fresh parse; both parsers report
diagnostic counts. The 100 MiB soak remains opt-in and is not part of the default comparison.

### Grammar milestone comparison (2026-08-13)

This Windows run used Node 24 and local SqlParser assembly
`18.0.0.0+740ec0cc0a5ea2281e2b5e36f24186cd68ee000c`. Each entry is a p50 from three
samples after one warmup. The corpus is valid, exact-size ASCII T-SQL with many `GO` batches; both
engines reported zero diagnostics. TypeScript incremental trees matched fresh tree checksums in
every lane.

|    Size | Engine           |  First full |   Warm full | Incremental start | Incremental middle | Incremental end |  Current RSS |
| ------: | ---------------- | ----------: | ----------: | ----------------: | -----------------: | --------------: | -----------: |
| 100 KiB | TypeScript Lezer |   126.98 ms |    71.55 ms |          14.28 ms |           11.17 ms |         3.15 ms |    95.93 MiB |
| 100 KiB | SqlParser        |   293.34 ms |   125.77 ms |          38.10 ms |           28.95 ms |        23.97 ms |    72.45 MiB |
|   1 MiB | TypeScript Lezer |   744.73 ms |   675.81 ms |          25.32 ms |           25.36 ms |        23.34 ms |   215.71 MiB |
|   1 MiB | SqlParser        | 1,463.15 ms |   604.37 ms |         278.01 ms |          276.89 ms |       315.37 ms |   251.39 MiB |
|  10 MiB | TypeScript Lezer | 6,804.49 ms | 6,847.33 ms |         164.28 ms |          162.80 ms |       162.99 ms |   425.91 MiB |
|  10 MiB | SqlParser        | 7,230.89 ms | 5,646.79 ms |       3,486.24 ms |        3,363.92 ms |     3,715.75 ms | 2,429.08 MiB |

Interpret the lanes independently: SqlParser's warmed whole parse is about 12% faster at 1 MiB and
21% faster at 10 MiB, while TypeScript's bounded GO-chunk updates are about 11–13 times faster at
1 MiB and 21–23 times faster at 10 MiB. Current RSS is a process observation after each complete
workload; peak RSS was 516.70 MiB for Node and 3,041.70 MiB for SqlParser at 10 MiB. It is not a
retained-tree or allocation measurement. The 100 MiB lane was not run.
