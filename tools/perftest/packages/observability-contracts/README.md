# @mssqlperf/observability-contracts

The **Shared Observability Contract**: one governed semantic vocabulary for
markers, spans, events, and metrics across vscode-mssql, perftest, and
(namespaced) STS. It does not force one physical record shape — it defines
what each name MEANS: kind, explicit pairing, owning feature, process roles,
field classifications, timing plane, and measurement eligibility.

## Contents

- `src/registry/event-types.json` — the event registry (exact names + prefix
  families like `rpc.` / `sts.dacfx.`) and derived metric names.
- `src/registry/classifications.json` — field-level data classification
  taxonomy (secret, userSql, resultData, providerText, identifierSensitive,
  structuralMetadata, diagnosticMetric, safeEnum).
- `src/registry/timing-classes.json` — sameProcessMonotonic / epochAligned /
  derived, with rendering + eligibility rules.
- `src/index.ts` — `loadRegistry()`, `explainEventName()` (exact + longest
  prefix), `isKnownMetricName()`, and **`deriveEligibility()`** — the single
  shared decision that replaces the overloaded `official` flag with
  structured trust labels (measurementEligible / ciGatingEligible /
  exploratory / diagnosticOnly + machine-assembled reason).
- `src/generate.ts` — emits `generated/markdown/EVENTS.md` and
  `generated/typescript/observabilityContract.generated.ts` (dependency-free
  snapshot vendored into vscode-mssql at
  `src/sharedInterfaces/observabilityContract.generated.ts`).

## Consumers

- **perftest-cli normalizer** stamps `eligibility` on every result metric
  (environment `controlledHarness`); collector sources and epoch-plane
  durations come out diagnostic-only by rule. Disagreement with the legacy
  `official` flag becomes a validation warning, never silence.
- **vscode-mssql self-test** stamps eligibility at persistence with
  environment `interactiveHost` (exploratory at best, never CI-gating); the
  time plane comes from the registry (a metric derived from an epoch-aligned
  input event, e.g. `toRender` via the webview render mark, is epoch here).
- **Conformance tests** in both repos grep the actually-emitted /
  actually-awaited names and fail on unregistered vocabulary.

## Workflow for changing the vocabulary

1. Edit the registry JSON.
2. `npm run build && npm test && npm run generate` here.
3. Copy `generated/typescript/observabilityContract.generated.ts` over
   `vscode-mssql/extensions/mssql/src/sharedInterfaces/`.
4. Both repos' conformance suites must pass.
