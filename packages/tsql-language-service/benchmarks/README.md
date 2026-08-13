# T-SQL language-service benchmarks

Benchmarks consume the built package and generate deterministic SQL and metadata in memory. Generated corpora and result artifacts are ignored.

The scaffold runner currently validates the benchmark dimensions and measures full parse, incremental parse, in-process runtime, and Node worker round trips. Later milestones fill the reserved semantic, feature, metadata, ScriptDOM, and SqlParser lanes.

```powershell
npm run benchmark:smoke
npm run benchmark -- --sizes 5k,100k,1m,10m
```

The 100 MiB workload is an explicit manual soak lane:

```powershell
npm run benchmark -- --sizes 100m
```

Correctness checks run before timings: incremental and fresh trees must have the same normalized checksum. Results report runtime environment, corpus seed, exact UTF-16 length, samples, and qualification notes.
