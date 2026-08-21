# Current readiness

Date: 2026-08-20

This report describes the current worktree while the audit remediation plan is active. It supersedes
the deleted milestone assessments and progress ledger, whose historical totals mixed different
commits, machines, corpora, and test lanes.

## Verified evidence

Run from `packages/tsql-language-service`:

```powershell
npm run check:grammar
npm run lint
npm run test:types
npm run test:offline
npm run test:integration
npm run test:performance
npm run benchmark:language-service -- --samples 10 --warmups 3 `
  --json benchmarks/generated/language-service.json
```

The most recent full offline run before this document was written passed 1,504 tests across 225
suites with no failures. Final release evidence must be regenerated after the remediation checklist
is fully checked; this number is not a frozen baseline and may increase as tests are added.

## Readiness assessment

The package is suitable for opt-in preview evaluation, not a general-availability claim. The shared
snapshot, incremental parser, metadata safety model, source mapping, coloring, folding, completion,
hover, navigation, signatures, diagnostics, workers, and observability all have executable coverage.
The remaining release risk is concentrated in uncommon grammar/recovery, incomplete semantic and
completion families, host scripting availability for catalog definitions, and large-scale operational
validation.

No correctness failure may be converted into a baseline increase, skip, fallback, or suppression.
The [active backlog](../backlog/ACTIVE_BACKLOG.md) is the authoritative list of known partial areas.

## Benchmark interpretation

Parser throughput and language-feature latency are separate reports. A fast parser result does not
prove completion, hover, or binding latency; a feature result does not hide its preceding open/edit,
refresh, or rebind cost. The lifecycle benchmark reports both first and warm requests and validates
incremental/fresh equivalence outside timed regions.

Results are comparable only when commit, Node version, CPU, corpus, document bytes, catalog size,
sample count, warmups, and seed match. Historical numbers without that identity are not readiness
evidence.

## Release blockers

- Finish every unchecked item in the audit remediation plan.
- Keep the conformance and real-world corpus free of per-fixture regressions.
- Pass clean-checkout offline, integration, worker, SQLCMD, hostile-identifier, metadata-concurrency,
  large-catalog, performance, and privacy lanes.
- Record a final lifecycle benchmark with no correctness mismatch and review p95/retained-memory
  changes against the prior same-machine run.
