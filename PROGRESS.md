## 2026-07-04 - Entry 32: CHUNK 1 of the rock-solid plan - Shared Observability Contract

Context: owner dropped three review docs at test root (integrated vision,
next steps, peer review) and asked for a final prioritization + autonomous
execution in large chunks with reassessment stops. Prioritization (trust
before features): C1 contracts+eligibility+honesty -> C2 evidence durability
(manifests/gaps/import safety/sink health/canaries) -> C3 Trace Identity V1 +
correlation health -> C4 scenario parity/graduation -> C5 cross-run analysis
-> C6 diagnostic recipes/XEvents/heap -> C7 STS2 integration (own workstream,
after its waves 1-3).

CHUNK 1 SHIPPED:

- packages/observability-contracts: event registry seeded from the VERIFIED
  emitted inventory (grep-extracted, incl. the pairing reality: begin/ready,
  submit/complete, .begin/.end - explicit pairsWith, never guessed), prefix
  families (rpc./webview./sts.\*), classification taxonomy (8 classes incl.
  providerText with no error-string loophole), timing classes, derived metric
  names; deriveEligibility() = THE shared trust decision; generator emits
  EVENTS.md + dependency-free TS snapshot; 18 tests (integrity, pairing
  symmetry, longest-prefix, honesty matrix, cross-repo name conformance).
- perf-contracts: Metric.eligibility (additive, schema versioned same).
- normalizer: stamps eligibility (controlledHarness); official-vs-eligibility
  disagreement -> validation warning (visible fog).
- vscode-mssql: vendored snapshot + conformance test (greps ACTUAL emitted
  literals - registry can't drift from code); self-test stamps eligibility
  (interactiveHost => exploratory; registry-driven time plane: toRender =
  epoch in-product, honestly diagnostic without calibration); Perf History
  Submetrics shows gate-eligible/exploratory/diagnostic pills + reason.
- Peer-review "decisions to freeze" resolved by implementation: #2 metric
  terminology (the 4-label object), #3 self-test never gates (exploratory).

VERIFY: contracts 18/18; perf-contracts 14/14; cli 44/44 + builds; inproc
12/12; extension 3272 passing (+4) / 1 known copilot flake; REAL RUN PROOF:
gate 4/4 official, result.json shows wallclock gate-eligible, toRender
diagnostic-only (epoch), collector metrics diagnostic, zero eligibility
warnings; console smoke 14.7ms.

NEXT (Chunk 2, on owner go): store manifests + size caps + integrity, exact
live gaps + store backfill, RunImportValidator adversarial corpus, sink
backpressure/health, provenance panels, privacy canary corpus.
