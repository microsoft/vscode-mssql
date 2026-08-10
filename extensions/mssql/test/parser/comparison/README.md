# T-SQL engine correctness oracle

This directory defines engine-neutral, editor-visible acceptance scenarios. It tests normalized
analysis contracts instead of parser AST shape, so future parser strategies can be evaluated
without changing the oracle.

Every scenario stays in the denominator. Unsupported features, missing results, extra exact-mode
diagnostics, wrong half-open spans, or thrown exceptions fail the scenario. The feature families
are syntax, recovery, diagnostic spans, DML/routine targets, scopes, symbols, references, SQL
types, and contextual completion.

Report raw pass counts and the equal-feature macro score. Per-feature counts remain visible so a
large grammar set cannot hide missing semantic/editor capabilities. The extension currently runs
the package engine through all 26 fixed scenarios.

Performance measurement lives in `packages/tsql-language-service/benchmarks`, not here. That runner
uses matched generated corpora and separately measures whole parse, whole analysis, incremental
batch update, materialization, malformed edits, `GO` boundary changes, identity reuse, checksum
equivalence, and optional retained memory.
