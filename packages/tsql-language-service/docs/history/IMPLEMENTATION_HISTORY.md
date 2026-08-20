# Implementation history

This replaces the former append-only progress ledger. The ledger mixed exploratory notes, temporary
paths, model commentary, and results from different commits, so it was not reliable readiness
evidence.

## Milestones retained

- 2026-08-13 to 2026-08-18: broad T-SQL grammar, profile gating, conformance fixtures, incremental
  GO-chunk parsing, parser benchmarks, and initial preview integration.
- 2026-08-18 to 2026-08-19: semantic model, catalog diagnostics, completion, hover, signatures,
  coloring, folding, definitions, metadata adapters, and worker protocol.
- 2026-08-20: source-mapping correctness, transactional metadata refresh, shared document snapshots,
  metadata session sharing, identifier ownership, type-safe syntax profiles, observability privacy,
  architecture boundaries, hermetic generated grammar, and lifecycle benchmark remediation.

For current claims use the [capability matrix](../readiness/CAPABILITY_MATRIX.md), [current readiness
report](../readiness/CURRENT_READINESS.md), and executable test/benchmark commands. Historical totals
must not be used as a release gate.
