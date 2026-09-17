/* ============================================================================
   Central observability store — canned reader views / iTVFs (central design
   §5.9/§9, review addendum C-3/C-5/C-9).

   Visibility rule (C-3): every view joins kind rows through
   central_entities.current_batch_id — rows from started/failed/abandoned/
   superseded batches are invisible BY CONSTRUCTION. Readers (Grafana, the
   in-product central provider, ad-hoc SQL) use these views, never base
   tables (enforced by roles.sql).

   PARITY (C-9): central.official_metric_samples reproduces the local SQLite
   view exactly — same SELECT list, same four-column repetition join, same
   WHERE. Central additions live in official_metric_samples_ex so the parity
   surface stays frozen. Conformance test T-B7 byte-compares fixture output.
   ============================================================================ */

CREATE OR ALTER VIEW central.visible_batches AS
SELECT e.entity_id, e.kind, e.natural_key, e.current_batch_id AS upload_batch_id,
       e.environment_hash, e.product_sha, e.upload_policy_id, e.updated_at_utc,
       b.uploader_id, b.tool, b.tool_version, b.committed_at_utc
FROM central.central_entities e
JOIN central.upload_batches b ON b.upload_batch_id = e.current_batch_id
WHERE e.purged_at_utc IS NULL;
GO

/* --------------------------------------------------------------------------
   official_metric_samples — FROZEN parity surface (C-9). Do not extend.
   -------------------------------------------------------------------------- */
CREATE OR ALTER VIEW central.official_metric_samples AS
SELECT
  r.run_id,
  r.pass_type,
  r.environment_hash,
  m.scenario_id,
  m.rep_id,
  m.name,
  m.value,
  m.unit,
  m.component,
  m.process_role,
  m.lower_is_better,
  m.tags_json
FROM central.metrics m
JOIN central.visible_batches v
  ON v.upload_batch_id = m.upload_batch_id AND v.kind = N'perfRun'
JOIN central.runs r
  ON r.upload_batch_id = m.upload_batch_id AND r.run_id = m.run_id
JOIN central.repetitions rep
  ON rep.upload_batch_id = m.upload_batch_id
 AND rep.run_id = m.run_id
 AND rep.scenario_id = m.scenario_id
 AND rep.rep_id = m.rep_id
 AND rep.attempt_id = m.attempt_id
WHERE m.official = 1
  AND r.pass_type = N'measurement'
  AND rep.status = N'passed';
GO

/* Central additions ride here, not on the parity surface. */
CREATE OR ALTER VIEW central.official_metric_samples_ex AS
SELECT
  s.*,
  v.uploader_id,
  v.tool,
  v.committed_at_utc,
  r.created_at_utc AS run_created_at_utc,
  rr.repo AS primary_repo,
  rr.sha AS primary_sha,
  rr.branch AS primary_branch
FROM central.official_metric_samples s
JOIN central.visible_batches v ON v.kind = N'perfRun' AND v.natural_key = s.run_id
JOIN central.runs r ON r.upload_batch_id = v.upload_batch_id AND r.run_id = s.run_id
OUTER APPLY (
  SELECT TOP (1) repo, sha, branch
  FROM central.run_repositories x
  WHERE x.upload_batch_id = v.upload_batch_id AND x.run_id = s.run_id
  ORDER BY repo
) rr;
GO

CREATE OR ALTER VIEW central.latest_run_per_scenario_env AS
SELECT scenario_id, environment_hash, run_id, run_created_at_utc, samples
FROM (
  SELECT
    s.scenario_id,
    s.environment_hash,
    s.run_id,
    MAX(r.created_at_utc) AS run_created_at_utc,
    COUNT(*) AS samples,
    ROW_NUMBER() OVER (PARTITION BY s.scenario_id, s.environment_hash
                       ORDER BY MAX(r.created_at_utc) DESC) AS rn
  FROM central.official_metric_samples s
  JOIN central.visible_batches v ON v.kind = N'perfRun' AND v.natural_key = s.run_id
  JOIN central.runs r ON r.upload_batch_id = v.upload_batch_id AND r.run_id = s.run_id
  GROUP BY s.scenario_id, s.environment_hash, s.run_id
) t
WHERE rn = 1;
GO

/* --------------------------------------------------------------------------
   trend — per-run medians for one scenario/metric/environment series.
   Matches the CLI trend math: median over passed measurement reps per run.
   -------------------------------------------------------------------------- */
CREATE OR ALTER FUNCTION central.trend (
  @scenario_id nvarchar(200),
  @metric_name nvarchar(200),
  @environment_hash nvarchar(100)
)
RETURNS TABLE
AS
RETURN
  SELECT DISTINCT
    s.run_id,
    r.created_at_utc AS run_created_at_utc,
    s.unit,
    s.lower_is_better,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.value)
      OVER (PARTITION BY s.run_id) AS median_value,
    COUNT(*) OVER (PARTITION BY s.run_id) AS samples
  FROM central.official_metric_samples s
  JOIN central.visible_batches v ON v.kind = N'perfRun' AND v.natural_key = s.run_id
  JOIN central.runs r ON r.upload_batch_id = v.upload_batch_id AND r.run_id = s.run_id
  WHERE s.scenario_id = @scenario_id
    AND s.name = @metric_name
    AND (@environment_hash = N'' OR s.environment_hash = @environment_hash);
GO

/* --------------------------------------------------------------------------
   regressions_last_30d — canned convenience (NOT the CI gate; the local
   exit-code gate remains authoritative). Latest run's median vs the median
   of prior runs in the window, flagged over a 10% threshold in the metric's
   better/worse direction.
   -------------------------------------------------------------------------- */
CREATE OR ALTER VIEW central.regressions_last_30d AS
WITH samples AS (
  SELECT s.scenario_id, s.name AS metric_name, s.environment_hash, s.unit,
         s.lower_is_better, s.run_id, r.created_at_utc,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.value)
           OVER (PARTITION BY s.scenario_id, s.name, s.environment_hash, s.run_id) AS run_median
  FROM central.official_metric_samples s
  JOIN central.visible_batches v ON v.kind = N'perfRun' AND v.natural_key = s.run_id
  JOIN central.runs r ON r.upload_batch_id = v.upload_batch_id AND r.run_id = s.run_id
  WHERE r.created_at_utc > DATEADD(day, -30, sysutcdatetime())
),
runs_ranked AS (
  SELECT DISTINCT scenario_id, metric_name, environment_hash, unit, lower_is_better,
         run_id, created_at_utc, run_median,
         ROW_NUMBER() OVER (PARTITION BY scenario_id, metric_name, environment_hash
                            ORDER BY created_at_utc DESC) AS rn
  FROM samples
),
latest AS (
  SELECT * FROM runs_ranked WHERE rn = 1
),
prior AS (
  SELECT scenario_id, metric_name, environment_hash,
         AVG(run_median) AS prior_mean, COUNT(*) AS prior_runs
  FROM runs_ranked WHERE rn > 1
  GROUP BY scenario_id, metric_name, environment_hash
)
SELECT l.scenario_id, l.metric_name, l.environment_hash, l.unit, l.lower_is_better,
       l.run_id AS latest_run_id, l.created_at_utc AS latest_run_utc,
       l.run_median AS latest_median, p.prior_mean, p.prior_runs,
       CASE WHEN p.prior_mean = 0 THEN NULL
            ELSE 100.0 * (l.run_median - p.prior_mean) / p.prior_mean END AS delta_pct,
       CASE
         WHEN p.prior_runs IS NULL OR p.prior_runs < 2 OR p.prior_mean = 0 THEN N'inconclusive'
         WHEN l.lower_is_better = 1 AND l.run_median > p.prior_mean * 1.10 THEN N'regressed'
         WHEN l.lower_is_better = 0 AND l.run_median < p.prior_mean * 0.90 THEN N'regressed'
         WHEN l.lower_is_better = 1 AND l.run_median < p.prior_mean * 0.90 THEN N'improved'
         WHEN l.lower_is_better = 0 AND l.run_median > p.prior_mean * 1.10 THEN N'improved'
         ELSE N'unchanged'
       END AS verdict
FROM latest l
LEFT JOIN prior p ON p.scenario_id = l.scenario_id AND p.metric_name = l.metric_name
                 AND p.environment_hash = l.environment_hash;
GO

/* --------------------------------------------------------------------------
   Session views — gap-aware (C-5): windows overlapping gaps are labeled
   partialWindow rather than pretending completeness (§5.9 reader honesty).
   -------------------------------------------------------------------------- */
CREATE OR ALTER VIEW central.sessions_by_feature_error_rate AS
SELECT
  s.session_id,
  s.product_sha,
  s.environment_hash,
  s.created_utc,
  e.feature,
  COUNT(*) AS events,
  SUM(CASE WHEN e.status = N'error' THEN 1 ELSE 0 END) AS error_events,
  CAST(SUM(CASE WHEN e.status = N'error' THEN 1 ELSE 0 END) AS float) / COUNT(*) AS error_rate,
  CASE WHEN s.gap_count > 0 THEN N'partialWindow' ELSE N'complete' END AS window_quality
FROM central.diag_sessions s
JOIN central.visible_batches v ON v.upload_batch_id = s.upload_batch_id AND v.kind = N'diagSession'
JOIN central.diag_events e ON e.session_sk = s.session_sk
GROUP BY s.session_id, s.product_sha, s.environment_hash, s.created_utc, e.feature, s.gap_count;
GO

CREATE OR ALTER VIEW central.sessions_by_build AS
SELECT
  s.product_sha,
  COUNT(DISTINCT s.session_id) AS sessions,
  SUM(s.event_count) AS events,
  SUM(s.gap_count) AS gaps,
  MIN(s.created_utc) AS first_session_utc,
  MAX(s.created_utc) AS last_session_utc
FROM central.diag_sessions s
JOIN central.visible_batches v ON v.upload_batch_id = s.upload_batch_id AND v.kind = N'diagSession'
WHERE s.product_sha IS NOT NULL
GROUP BY s.product_sha;
GO

/* --------------------------------------------------------------------------
   fleet_by_build — the cross-kind question: what did dogfood sessions see on
   builds that CI also measured?
   -------------------------------------------------------------------------- */
CREATE OR ALTER VIEW central.fleet_by_build AS
WITH run_shas AS (
  SELECT DISTINCT rr.sha, rr.repo, r.run_id, r.status, r.created_at_utc
  FROM central.run_repositories rr
  JOIN central.visible_batches v ON v.upload_batch_id = rr.upload_batch_id AND v.kind = N'perfRun'
  JOIN central.runs r ON r.upload_batch_id = rr.upload_batch_id AND r.run_id = rr.run_id
),
session_shas AS (
  SELECT s.product_sha AS sha,
         COUNT(DISTINCT s.session_id) AS sessions,
         SUM(s.event_count) AS session_events,
         SUM(s.gap_count) AS session_gaps
  FROM central.diag_sessions s
  JOIN central.visible_batches v ON v.upload_batch_id = s.upload_batch_id AND v.kind = N'diagSession'
  WHERE s.product_sha IS NOT NULL
  GROUP BY s.product_sha
)
SELECT
  COALESCE(r.sha, se.sha) AS sha,
  MAX(r.repo) AS repo,
  COUNT(DISTINCT r.run_id) AS perf_runs,
  SUM(CASE WHEN r.status = N'passed' THEN 1 ELSE 0 END) AS perf_runs_passed,
  MAX(se.sessions) AS dogfood_sessions,
  MAX(se.session_events) AS dogfood_events,
  MAX(se.session_gaps) AS dogfood_gaps
FROM run_shas r
FULL OUTER JOIN session_shas se ON se.sha = r.sha
GROUP BY COALESCE(r.sha, se.sha);
GO

/* --------------------------------------------------------------------------
   Ledger / operations views
   -------------------------------------------------------------------------- */
CREATE OR ALTER VIEW central.upload_history AS
SELECT
  b.upload_batch_id, b.source_kind, b.natural_key, b.status, b.outcome_reason,
  b.tool, b.tool_version, b.upload_policy_id, b.contract_version, b.projector_version,
  b.started_at_utc, b.committed_at_utc,
  u.principal_kind, u.principal_digest, u.display_name, u.is_ci,
  b.row_counts_json, b.source_digest, b.projection_digest, b.preview_digest
FROM central.upload_batches b
JOIN central.uploaders u ON u.uploader_id = b.uploader_id;
GO

CREATE OR ALTER VIEW central.policy_drop_summary AS
SELECT
  b.upload_policy_id,
  b.source_kind,
  d.[key] AS field,
  SUM(TRY_CONVERT(int, JSON_VALUE(d.[value], N'$.count'))) AS dropped_count,
  COUNT(DISTINCT b.upload_batch_id) AS batches
FROM central.upload_batches b
CROSS APPLY OPENJSON(b.dropped_counts_json) d
WHERE b.status IN (N'committed', N'reprojected', N'extended')
GROUP BY b.upload_policy_id, b.source_kind, d.[key];
GO

CREATE OR ALTER VIEW central.ingestion_failures AS
SELECT
  b.upload_batch_id, b.source_kind, b.natural_key, b.status, b.outcome_reason,
  b.tool, b.started_at_utc, u.principal_digest,
  i.item_kind, i.item_ordinal, i.error_code, i.error_message
FROM central.upload_batches b
JOIN central.uploaders u ON u.uploader_id = b.uploader_id
LEFT JOIN central.upload_items i
  ON i.upload_batch_id = b.upload_batch_id AND i.status = N'failed'
WHERE b.status IN (N'failed', N'refused', N'abandoned');
GO

CREATE OR ALTER VIEW central.central_health AS
SELECT
  (SELECT schema_version FROM central.schema_info WHERE schema_name = N'central') AS schema_version,
  (SELECT contract_version FROM central.schema_info WHERE schema_name = N'central') AS contract_version,
  (SELECT COUNT(*) FROM central.central_entities WHERE purged_at_utc IS NULL AND kind = N'perfRun') AS perf_run_entities,
  (SELECT COUNT(*) FROM central.central_entities WHERE purged_at_utc IS NULL AND kind = N'diagSession') AS diag_session_entities,
  (SELECT MAX(committed_at_utc) FROM central.upload_batches WHERE status IN (N'committed', N'reprojected', N'extended')) AS latest_commit_utc,
  (SELECT COUNT(*) FROM central.upload_batches WHERE status = N'started') AS started_batches,
  (SELECT COUNT(*) FROM central.upload_batches
    WHERE status IN (N'failed', N'refused') AND started_at_utc > DATEADD(day, -7, sysutcdatetime())) AS failed_or_refused_7d,
  (SELECT COUNT(*) FROM central.diag_events) AS diag_event_rows,
  (SELECT MAX(at_utc) FROM central.maintenance_log WHERE action = N'retentionCleanup') AS last_retention_cleanup_utc;
GO
