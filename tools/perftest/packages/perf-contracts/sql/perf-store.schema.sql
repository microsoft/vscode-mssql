PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  created_at_unix_ns TEXT NOT NULL,
  pass_type TEXT NOT NULL CHECK (pass_type IN ('measurement', 'diagnostic', 'calibration')),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'invalid', 'aborted')),
  config_hash TEXT NOT NULL,
  config_path TEXT,
  output_dir TEXT NOT NULL,
  environment_hash TEXT NOT NULL,
  machine_id TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS run_repositories (
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  sha TEXT NOT NULL,
  branch TEXT,
  dirty INTEGER NOT NULL CHECK (dirty IN (0, 1)),
  remote TEXT,
  PRIMARY KEY (run_id, repo)
);

CREATE TABLE IF NOT EXISTS environments (
  environment_hash TEXT PRIMARY KEY,
  captured_at_unix_ns TEXT NOT NULL,
  machine_id TEXT,
  os_platform TEXT,
  os_version TEXT,
  cpu_model TEXT,
  logical_cores INTEGER,
  memory_total_mb INTEGER,
  vscode_version TEXT,
  extension_versions_json TEXT,
  sts_version TEXT,
  sql_image_digest TEXT,
  sql_snapshot TEXT,
  config_fingerprint_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenarios (
  scenario_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  owner TEXT,
  tags_json TEXT,
  definition_hash TEXT
);

CREATE TABLE IF NOT EXISTS repetitions (
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(scenario_id),
  rep_id INTEGER NOT NULL,
  attempt_id INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'invalid', 'aborted')),
  warmup INTEGER NOT NULL CHECK (warmup IN (0, 1)),
  trace_id TEXT,
  start_unix_ns TEXT,
  end_unix_ns TEXT,
  result_path TEXT NOT NULL,
  PRIMARY KEY (run_id, scenario_id, rep_id, attempt_id)
);

CREATE TABLE IF NOT EXISTS metrics (
  metric_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  rep_id INTEGER NOT NULL,
  attempt_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  component TEXT NOT NULL,
  process_role TEXT NOT NULL,
  source TEXT NOT NULL,
  official INTEGER NOT NULL CHECK (official IN (0, 1)),
  lower_is_better INTEGER NOT NULL CHECK (lower_is_better IN (0, 1)),
  aggregation TEXT,
  trace_id TEXT,
  span_id TEXT,
  start_unix_ns TEXT,
  end_unix_ns TEXT,
  confidence TEXT,
  tags_json TEXT,
  derivation_json TEXT,
  FOREIGN KEY (run_id, scenario_id, rep_id, attempt_id)
    REFERENCES repetitions(run_id, scenario_id, rep_id, attempt_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_metrics_key
  ON metrics(scenario_id, name, component, process_role, official, unit);

CREATE INDEX IF NOT EXISTS idx_metrics_run
  ON metrics(run_id, scenario_id, rep_id);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  scenario_id TEXT,
  rep_id INTEGER,
  attempt_id INTEGER DEFAULT 0,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  retention TEXT NOT NULL CHECK (retention IN ('always', 'on-regression', 'on-failure', 'never')),
  size_bytes INTEGER,
  sha256 TEXT,
  content_type TEXT,
  created_at_unix_ns TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS validations (
  validation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  scenario_id TEXT,
  rep_id INTEGER,
  attempt_id INTEGER DEFAULT 0,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'warning', 'failed', 'skipped')),
  message TEXT,
  details_json TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS baselines (
  baseline_name TEXT NOT NULL,
  scenario_id TEXT,
  metric_name TEXT,
  environment_hash TEXT,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  created_at_unix_ns TEXT NOT NULL,
  created_by TEXT,
  notes TEXT,
  PRIMARY KEY (baseline_name, scenario_id, metric_name, environment_hash)
);

CREATE TABLE IF NOT EXISTS comparisons (
  comparison_id INTEGER PRIMARY KEY AUTOINCREMENT,
  current_run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  baseline_run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  created_at_unix_ns TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'regressed', 'improved', 'inconclusive', 'failed')),
  summary_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comparison_metrics (
  comparison_metric_id INTEGER PRIMARY KEY AUTOINCREMENT,
  comparison_id INTEGER NOT NULL REFERENCES comparisons(comparison_id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  component TEXT NOT NULL,
  process_role TEXT NOT NULL,
  unit TEXT NOT NULL,
  official INTEGER NOT NULL CHECK (official IN (0, 1)),
  baseline_value REAL,
  current_value REAL,
  delta_abs REAL,
  delta_pct REAL,
  baseline_samples INTEGER,
  current_samples INTEGER,
  p_value REAL,
  verdict TEXT NOT NULL CHECK (verdict IN ('regressed', 'improved', 'unchanged', 'inconclusive')),
  threshold_json TEXT,
  details_json TEXT
);

CREATE VIEW IF NOT EXISTS official_metric_samples AS
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
FROM metrics m
JOIN runs r ON r.run_id = m.run_id
JOIN repetitions rep
  ON rep.run_id = m.run_id
 AND rep.scenario_id = m.scenario_id
 AND rep.rep_id = m.rep_id
 AND rep.attempt_id = m.attempt_id
WHERE m.official = 1
  AND r.pass_type = 'measurement'
  AND rep.status = 'passed';
