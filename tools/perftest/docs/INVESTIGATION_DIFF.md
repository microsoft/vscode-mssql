# A/B investigation diff

Phase-2 M11: `perftest diff --baseline <runId> --candidate <runId> [--json]`
turns before/after into a "what changed" investigation across official AND
diagnostic signals — while the gate verdict remains driven **only** by
official metrics.

## Sections

1. **Official gate** — the existing §24 comparison (environment-hash-matched,
   warmup-excluded, thresholds + Welch t). Exit code 1 on regression, exactly
   like `compare`.
2. **Investigation (explicitly non-gating)**:
    - **SQL activity delta** — the headline. Top-level commands
      (`rpc_completed`/`sql_batch_completed`) from each run's
      `sql-activity.jsonl`, grouped by object name or normalized statement
      text (whitespace collapsed, literals parameterized): commands **added**,
      **removed**, and **changed** (extra round-trips, duration deltas, logical
      read deltas). One-sided captures produce an honest note instead of a
      partial diff.
    - **Metric deltas** — medians over passed non-warmup reps for every metric
      (official tagged vs diagnostic), sorted by |Δ%|, filtered to |Δ| ≥ 5% and
      ≥ 1 unit.
    - **Git context** — repo@sha (+dirty) for both runs from
      `run_repositories`, so perf deltas correlate to code deltas.
      (`environmentHash` deliberately excludes product SHAs — cross-code
      comparison is the whole point.)
3. `investigation.json` persisted beside the candidate run (additive; the
   existing `comparison.json` is unchanged).

## Requirements

- Both runs in the same SQLite store; matching environment hashes (or
  `--allow-cross-environment`, clearly surfaced).
- For the SQL-activity headline, both runs need
  `diagnostics.sqlServerXEvents: true` (diagnostic pass). Without it the diff
  still renders gate + metric deltas and says what's missing.

## Open (11.3)

Markdown/HTML investigation report and the extra-SQL-round-trip acceptance
run are tracked in IMPLEMENTATION_PLAN.md.
