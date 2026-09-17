# Regression model

How official metrics become verdicts (design §24). Implementation:
`packages/perftest-cli/src/regression/` (statistics, classification,
comparison orchestration) — all pure logic under unit test, because these
numbers gate CI.

## What is eligible

Only samples that survive every filter, applied structurally in SQL
(`PerfStore.officialSamples`):

- `official = 1` metrics (markers/product timers only, by construction),
- from a `measurement` pass,
- on reps with `status = 'passed'`,
- **excluding warmup reps** (`repetitions.warmup = 0`).

`failed` reps contribute nothing. `invalid` reps contribute nothing and never
can — they have no official metrics at all.

## Aggregation (§24.1)

Per metric key (`scenarioId + name + component + processRole + unit`):
**20% trimmed mean** when n ≥ 10, **median** otherwise. Reports always carry
the full distribution: mean, median, min, max, stdDev, CV, p90, p95, 95% CI.

## Classification (§24.3)

For each metric key present in either run:

1. **Minimum samples** (default 3 per side) or `inconclusive` — never gated.
2. **Variance check**: CV above `maxCv` (default 0.2) on either side ⇒
   `inconclusive` (a noisy environment cannot produce a verdict).
3. Delta of aggregates, direction-aware via `lowerIsBetter`.
4. **Both thresholds must trip** to regress: percent (`pct`, default 10%)
   AND absolute floor (`absMs`, default 5 ms) — a +50% delta on a 1 ms metric
   never gates.
5. **Welch's t-test** (unequal variances, two-tailed): a threshold-exceeding
   delta that isn't significant (`p > 0.05`) is `inconclusive`, not
   `regressed`.
6. Verdict: `regressed` | `improved` | `unchanged` | `inconclusive`, each
   with a human-readable reason.

Run status = **worst metric wins**: any `regressed` ⇒ run regressed (exit 1
when `regression.failOnRegression`); all-inconclusive ⇒ `inconclusive`
(exit 6); otherwise improved/passed (exit 0).

Thresholds come from config (`regression.thresholds.default` +
per-metric overrides in `regression.thresholds.metrics`).

## Environment comparability (§23.1)

Comparison requires **matching environment hashes** and refuses otherwise
(`--allow-cross-environment` to override, clearly marked in the output). The
hash covers hardware, OS, VS Code build, extension set, STS version, SQL
image/seed/cache mode, pass type, and the environment-relevant config subset
— deliberately **not** rep counts, thresholds, scenario lists, or product git
SHAs (comparing across code changes is the whole point; comparing across
machines or SQL images is meaningless).

## Baselines

`perftest baseline set <name> <runId>` binds a name to a run (+ its
environment hash) in the `baselines` table. `regression.baseline` in the
config (a name or explicit runId) triggers the automatic post-run comparison
and gate. `baseline: "none"` disables gating.

## Proven behavior (M6′ acceptance)

- A **250 ms synthetic delay** injected into the measured window of the same
  scenario (via `PERF_SYNTHETIC_DELAY_MS`, recorded transparently on the
  scenario.end marker) produces a `REGRESSED` verdict and exit code 1 against
  the undelayed baseline.
- A scenario whose required end marker **never arrives** produces `invalid`
  reps with **no wallclock metric at all** and exit code 6 — never a bogus
  fast number.
