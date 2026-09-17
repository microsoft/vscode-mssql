/* ============================================================================
   Central observability store — SQL Server schema (central design §5,
   review addendum C-1..C-10, H-1/H-2).

   Dialect: SQL Server 2019+ (min compat level 150). Idempotent: safe to run
   on an empty database; `perftest central init` executes this file, then
   procedures, views, and roles.

   Invariants encoded here:
   - Reader visibility is STRUCTURAL (C-3): kind rows carry upload_batch_id
     and are visible only through central_entities.current_batch_id joins.
     Kind-table uniqueness is therefore per-batch; global natural-key
     uniqueness lives on central_entities(kind, natural_key).
   - `source_digest` is stored on batches AND entities (C-1): the refusal /
     reprojection algebra keys on pre-policy source identity.
   - diag_events/diag_gaps key on session_sk (H-1), halving index width and
     making retention a whole-session operation.
   - Writers never INSERT tables directly; procedures only (roles.sql).
   ============================================================================ */

IF SCHEMA_ID(N'central') IS NULL
    EXEC(N'CREATE SCHEMA central');
GO

/* ---------------------------------------------------------------------------
   schema_info (H-2: records contract + vendored vocabulary versions so
   `perftest central check` can flag skew between writers and store)
   --------------------------------------------------------------------------- */
IF OBJECT_ID(N'central.schema_info') IS NULL
BEGIN
    CREATE TABLE central.schema_info (
        schema_name          sysname       NOT NULL PRIMARY KEY,
        schema_version       nvarchar(40)  NOT NULL,
        contract_version     nvarchar(40)  NOT NULL,
        rank_table_version   nvarchar(40)  NOT NULL,
        union_versions_json  nvarchar(max) NOT NULL CHECK (ISJSON(union_versions_json) = 1),
        min_compat_level     int           NOT NULL,
        created_at_utc       datetime2(3)  NOT NULL DEFAULT sysutcdatetime(),
        updated_at_utc       datetime2(3)  NOT NULL DEFAULT sysutcdatetime()
    );
END
GO

/* ---------------------------------------------------------------------------
   Uploaders (C-14: digests, not labels; display_name only when policy allows)
   --------------------------------------------------------------------------- */
IF OBJECT_ID(N'central.uploaders') IS NULL
BEGIN
    CREATE TABLE central.uploaders (
        uploader_id        bigint IDENTITY(1,1) PRIMARY KEY,
        principal_kind     nvarchar(30)  NOT NULL
            CHECK (principal_kind IN (N'domainUser', N'alias', N'ci', N'servicePrincipal')),
        principal_digest   nvarchar(80)  NOT NULL,
        display_name       nvarchar(200) NULL,
        is_ci              bit           NOT NULL DEFAULT 0,
        first_seen_utc     datetime2(3)  NOT NULL DEFAULT sysutcdatetime(),
        last_seen_utc      datetime2(3)  NULL,
        CONSTRAINT uq_uploaders_principal UNIQUE (principal_kind, principal_digest)
    );
END
GO

/* ---------------------------------------------------------------------------
   Upload batches (one attempt; C-1 status algebra incl. `extended`)
   --------------------------------------------------------------------------- */
IF OBJECT_ID(N'central.upload_batches') IS NULL
BEGIN
    CREATE TABLE central.upload_batches (
        upload_batch_id       bigint IDENTITY(1,1) PRIMARY KEY,
        uploader_id           bigint        NOT NULL REFERENCES central.uploaders(uploader_id),
        tool                  nvarchar(60)  NOT NULL,   -- perftest-push | debug-console
        tool_version          nvarchar(60)  NOT NULL,
        contract_version      nvarchar(40)  NOT NULL,
        projector_version     nvarchar(80)  NOT NULL,
        upload_policy_id      nvarchar(120) NOT NULL,
        source_kind           nvarchar(30)  NOT NULL
            CHECK (source_kind IN (N'perfRun', N'diagSession', N'featureTrace')),
        natural_key           nvarchar(200) NOT NULL,
        source_digest         nvarchar(100) NOT NULL,
        content_digest        nvarchar(100) NOT NULL,
        projection_digest     nvarchar(100) NOT NULL,
        preview_digest        nvarchar(100) NOT NULL,
        status                nvarchar(30)  NOT NULL DEFAULT N'started'
            CHECK (status IN (N'started', N'committed', N'alreadyPresent', N'reprojected',
                              N'extended', N'refused', N'failed', N'abandoned', N'purged')),
        outcome_reason        nvarchar(200) NULL,
        row_counts_json       nvarchar(max) NOT NULL DEFAULT N'{}' CHECK (ISJSON(row_counts_json) = 1),
        dropped_counts_json   nvarchar(max) NOT NULL DEFAULT N'{}' CHECK (ISJSON(dropped_counts_json) = 1),
        digested_counts_json  nvarchar(max) NOT NULL DEFAULT N'{}' CHECK (ISJSON(digested_counts_json) = 1),
        source_summary_json   nvarchar(max) NOT NULL DEFAULT N'{}' CHECK (ISJSON(source_summary_json) = 1),
        started_at_utc        datetime2(3)  NOT NULL DEFAULT sysutcdatetime(),
        committed_at_utc      datetime2(3)  NULL
    );
    CREATE INDEX ix_upload_batches_key ON central.upload_batches(source_kind, natural_key, status)
        INCLUDE (uploader_id, started_at_utc);
    CREATE INDEX ix_upload_batches_time ON central.upload_batches(started_at_utc DESC)
        INCLUDE (status, source_kind, tool);
END
GO

/* ---------------------------------------------------------------------------
   Upload items (staged slices; per-batch accounting for H-3 commit checks)
   --------------------------------------------------------------------------- */
IF OBJECT_ID(N'central.upload_items') IS NULL
BEGIN
    CREATE TABLE central.upload_items (
        upload_item_id     bigint IDENTITY(1,1) PRIMARY KEY,
        upload_batch_id    bigint        NOT NULL REFERENCES central.upload_batches(upload_batch_id),
        item_kind          nvarchar(50)  NOT NULL,
        item_ordinal       int           NOT NULL,
        row_count          int           NOT NULL,
        payload_digest     nvarchar(100) NOT NULL,
        status             nvarchar(30)  NOT NULL DEFAULT N'staged'
            CHECK (status IN (N'staged', N'applied', N'skipped', N'failed')),
        error_code         nvarchar(80)  NULL,
        error_message      nvarchar(400) NULL,
        created_at_utc     datetime2(3)  NOT NULL DEFAULT sysutcdatetime(),
        CONSTRAINT uq_upload_items_batch_kind_ordinal UNIQUE (upload_batch_id, item_kind, item_ordinal)
    );
END
GO

/* ---------------------------------------------------------------------------
   Central entities (current projection state; global natural-key uniqueness)
   --------------------------------------------------------------------------- */
IF OBJECT_ID(N'central.central_entities') IS NULL
BEGIN
    CREATE TABLE central.central_entities (
        entity_id            bigint IDENTITY(1,1) PRIMARY KEY,
        kind                 nvarchar(30)  NOT NULL
            CHECK (kind IN (N'perfRun', N'diagSession', N'featureTrace')),
        natural_key          nvarchar(200) NOT NULL,
        current_batch_id     bigint        NOT NULL REFERENCES central.upload_batches(upload_batch_id),
        contract_version     nvarchar(40)  NOT NULL,
        projector_version    nvarchar(80)  NOT NULL,
        source_digest        nvarchar(100) NOT NULL,
        content_digest       nvarchar(100) NOT NULL,
        projection_digest    nvarchar(100) NOT NULL,
        upload_policy_id     nvarchar(120) NOT NULL,
        environment_hash     nvarchar(100) NULL,
        product_sha          nvarchar(80)  NULL,
        created_at_utc       datetime2(3)  NOT NULL DEFAULT sysutcdatetime(),
        updated_at_utc       datetime2(3)  NOT NULL DEFAULT sysutcdatetime(),
        purged_at_utc        datetime2(3)  NULL,
        CONSTRAINT uq_central_entities_kind_key UNIQUE (kind, natural_key)
    );
    CREATE INDEX ix_central_entities_batch ON central.central_entities(current_batch_id);
    CREATE INDEX ix_central_entities_sha ON central.central_entities(product_sha)
        WHERE product_sha IS NOT NULL;
END
GO

/* ---------------------------------------------------------------------------
   Perf-run twin tables (Tier 1). Subtraction list applied (C-8): no
   output_dir / config_path / result_path columns; machine_id and notes are
   post-policy values. attempt_id everywhere (C-9).
   --------------------------------------------------------------------------- */
IF OBJECT_ID(N'central.runs') IS NULL
BEGIN
    CREATE TABLE central.runs (
        upload_batch_id      bigint        NOT NULL REFERENCES central.upload_batches(upload_batch_id),
        run_id               nvarchar(100) NOT NULL,
        created_at_unix_ns   nvarchar(30)  NOT NULL,
        created_at_utc       datetime2(3)  NOT NULL,
        pass_type            nvarchar(20)  NOT NULL
            CHECK (pass_type IN (N'measurement', N'diagnostic', N'calibration')),
        status               nvarchar(20)  NOT NULL
            CHECK (status IN (N'passed', N'failed', N'invalid', N'aborted')),
        config_hash          nvarchar(100) NOT NULL,
        environment_hash     nvarchar(100) NOT NULL,
        machine_id           nvarchar(200) NULL,
        notes                nvarchar(max) NULL,
        CONSTRAINT pk_runs PRIMARY KEY (upload_batch_id, run_id)
    );
    CREATE INDEX ix_runs_run ON central.runs(run_id) INCLUDE (environment_hash, pass_type, status);
END
GO

IF OBJECT_ID(N'central.run_repositories') IS NULL
BEGIN
    CREATE TABLE central.run_repositories (
        upload_batch_id    bigint        NOT NULL REFERENCES central.upload_batches(upload_batch_id),
        run_id             nvarchar(100) NOT NULL,
        repo               nvarchar(200) NOT NULL,
        sha                nvarchar(80)  NOT NULL,
        branch             nvarchar(200) NULL,
        dirty              bit           NOT NULL,
        remote             nvarchar(400) NULL,
        CONSTRAINT pk_run_repositories PRIMARY KEY (upload_batch_id, run_id, repo)
    );
    CREATE INDEX ix_run_repositories_sha ON central.run_repositories(repo, sha);
END
GO

IF OBJECT_ID(N'central.environments') IS NULL
BEGIN
    CREATE TABLE central.environments (
        upload_batch_id          bigint        NOT NULL REFERENCES central.upload_batches(upload_batch_id),
        environment_hash         nvarchar(100) NOT NULL,
        captured_at_unix_ns      nvarchar(30)  NOT NULL,
        captured_at_utc          datetime2(3)  NOT NULL,
        machine_id               nvarchar(200) NULL,
        os_platform              nvarchar(60)  NULL,
        os_version               nvarchar(200) NULL,
        cpu_model                nvarchar(200) NULL,
        logical_cores            int           NULL,
        memory_total_mb          int           NULL,
        vscode_version           nvarchar(60)  NULL,
        extension_versions_json  nvarchar(max) NULL,
        sts_version              nvarchar(60)  NULL,
        sql_image_digest         nvarchar(200) NULL,
        sql_snapshot             nvarchar(200) NULL,
        config_fingerprint_json  nvarchar(max) NOT NULL CHECK (ISJSON(config_fingerprint_json) = 1),
        CONSTRAINT pk_environments PRIMARY KEY (upload_batch_id, environment_hash)
    );
END
GO

IF OBJECT_ID(N'central.scenarios') IS NULL
BEGIN
    CREATE TABLE central.scenarios (
        upload_batch_id    bigint        NOT NULL REFERENCES central.upload_batches(upload_batch_id),
        scenario_id        nvarchar(200) NOT NULL,
        display_name       nvarchar(400) NOT NULL,
        owner              nvarchar(200) NULL,
        tags_json          nvarchar(max) NULL,
        definition_hash    nvarchar(100) NULL,
        CONSTRAINT pk_scenarios PRIMARY KEY (upload_batch_id, scenario_id)
    );
END
GO

IF OBJECT_ID(N'central.repetitions') IS NULL
BEGIN
    CREATE TABLE central.repetitions (
        upload_batch_id    bigint        NOT NULL REFERENCES central.upload_batches(upload_batch_id),
        run_id             nvarchar(100) NOT NULL,
        scenario_id        nvarchar(200) NOT NULL,
        rep_id             int           NOT NULL,
        attempt_id         int           NOT NULL DEFAULT 0,
        status             nvarchar(20)  NOT NULL
            CHECK (status IN (N'passed', N'failed', N'invalid', N'aborted')),
        warmup             bit           NOT NULL,
        trace_id           nvarchar(80)  NULL,
        start_unix_ns      nvarchar(30)  NULL,
        end_unix_ns        nvarchar(30)  NULL,
        start_utc          datetime2(3)  NULL,
        end_utc            datetime2(3)  NULL,
        CONSTRAINT pk_repetitions PRIMARY KEY (upload_batch_id, run_id, scenario_id, rep_id, attempt_id)
    );
END
GO

IF OBJECT_ID(N'central.metrics') IS NULL
BEGIN
    CREATE TABLE central.metrics (
        metric_id          bigint IDENTITY(1,1) PRIMARY KEY,
        upload_batch_id    bigint        NOT NULL REFERENCES central.upload_batches(upload_batch_id),
        run_id             nvarchar(100) NOT NULL,
        scenario_id        nvarchar(200) NOT NULL,
        rep_id             int           NOT NULL,
        attempt_id         int           NOT NULL DEFAULT 0,
        name               nvarchar(200) NOT NULL,
        value              float         NOT NULL,
        unit               nvarchar(40)  NOT NULL,
        component          nvarchar(80)  NOT NULL,
        process_role       nvarchar(80)  NOT NULL,
        source             nvarchar(40)  NOT NULL,
        official           bit           NOT NULL,
        lower_is_better    bit           NOT NULL,
        aggregation        nvarchar(40)  NULL,
        trace_id           nvarchar(80)  NULL,
        span_id            nvarchar(40)  NULL,
        start_unix_ns      nvarchar(30)  NULL,
        end_unix_ns        nvarchar(30)  NULL,
        confidence         nvarchar(20)  NULL,
        tags_json          nvarchar(max) NULL,
        derivation_json    nvarchar(max) NULL
    );
    CREATE INDEX ix_metrics_key ON central.metrics(scenario_id, name, component, process_role, official, unit);
    CREATE INDEX ix_metrics_run ON central.metrics(upload_batch_id, run_id, scenario_id, rep_id);
END
GO

IF OBJECT_ID(N'central.validations') IS NULL
BEGIN
    CREATE TABLE central.validations (
        validation_id      bigint IDENTITY(1,1) PRIMARY KEY,
        upload_batch_id    bigint        NOT NULL REFERENCES central.upload_batches(upload_batch_id),
        run_id             nvarchar(100) NOT NULL,
        scenario_id        nvarchar(200) NULL,
        rep_id             int           NULL,
        attempt_id         int           NULL,
        name               nvarchar(200) NOT NULL,
        status             nvarchar(20)  NOT NULL
            CHECK (status IN (N'passed', N'warning', N'failed', N'skipped')),
        message            nvarchar(max) NULL,
        details_json       nvarchar(max) NULL
    );
    CREATE INDEX ix_validations_run ON central.validations(upload_batch_id, run_id);
END
GO

IF OBJECT_ID(N'central.artifact_refs') IS NULL
BEGIN
    CREATE TABLE central.artifact_refs (
        artifact_ref_id    bigint IDENTITY(1,1) PRIMARY KEY,
        upload_batch_id    bigint        NOT NULL REFERENCES central.upload_batches(upload_batch_id),
        run_id             nvarchar(100) NOT NULL,
        scenario_id        nvarchar(200) NULL,
        rep_id             int           NULL,
        attempt_id         int           NULL,
        kind               nvarchar(80)  NOT NULL,
        relative_path      nvarchar(400) NOT NULL,
        retention          nvarchar(20)  NOT NULL
            CHECK (retention IN (N'always', N'on-regression', N'on-failure', N'never')),
        size_bytes         bigint        NULL,
        sha256             nvarchar(80)  NULL,
        content_type       nvarchar(120) NULL,
        created_at_unix_ns nvarchar(30)  NULL,
        created_at_utc     datetime2(3)  NULL
    );
    CREATE INDEX ix_artifact_refs_run ON central.artifact_refs(upload_batch_id, run_id);
END
GO

/* Baselines: not batch-scoped — mutable named pointers, CI/admin only (C-10,
   H-5). SQLite's nullable composite PK maps to NOT NULL '' wildcards. */
IF OBJECT_ID(N'central.baselines') IS NULL
BEGIN
    CREATE TABLE central.baselines (
        baseline_id        bigint IDENTITY(1,1) PRIMARY KEY,
        baseline_name      nvarchar(120) NOT NULL,
        scenario_id        nvarchar(200) NOT NULL DEFAULT N'',
        metric_name        nvarchar(200) NOT NULL DEFAULT N'',
        environment_hash   nvarchar(100) NOT NULL DEFAULT N'',
        run_id             nvarchar(100) NOT NULL,
        uploader_id        bigint        NOT NULL REFERENCES central.uploaders(uploader_id),
        created_at_utc     datetime2(3)  NOT NULL DEFAULT sysutcdatetime(),
        CONSTRAINT uq_baselines UNIQUE (baseline_name, scenario_id, metric_name, environment_hash)
    );
END
GO

/* ---------------------------------------------------------------------------
   Diagnostic session tables (C-4/C-5/C-6, H-1). Note: session natural-key
   uniqueness is enforced on central_entities; per-batch uniqueness here so
   reprojection can stage beside the current rows.
   --------------------------------------------------------------------------- */
IF OBJECT_ID(N'central.diag_sessions') IS NULL
BEGIN
    CREATE TABLE central.diag_sessions (
        session_sk         int IDENTITY(1,1) PRIMARY KEY,
        upload_batch_id    bigint        NOT NULL REFERENCES central.upload_batches(upload_batch_id),
        session_id         nvarchar(100) NOT NULL,
        source             nvarchar(30)  NOT NULL CHECK (source IN (N'live', N'perfRun', N'bundle')),
        capture_mode       nvarchar(40)  NOT NULL
            CHECK (capture_mode IN (N'off', N'redacted', N'digest', N'full')),
        capture_policy_id  nvarchar(120) NOT NULL,
        upload_policy_id   nvarchar(120) NOT NULL,   -- filled from the batch by the proc
        created_utc        datetime2(3)  NOT NULL,
        updated_utc        datetime2(3)  NOT NULL,
        event_count        int           NOT NULL,
        gap_count          int           NOT NULL,
        source_size_bytes  bigint        NULL,
        provenance_json    nvarchar(max) NOT NULL CHECK (ISJSON(provenance_json) = 1),
        environment_hash   nvarchar(100) NULL,
        product_sha        nvarchar(80)  NULL,
        status             nvarchar(20)  NOT NULL CHECK (status IN (N'active', N'closed', N'partial')),
        CONSTRAINT uq_diag_sessions_batch_session UNIQUE (upload_batch_id, session_id)
    );
    CREATE INDEX ix_diag_sessions_session ON central.diag_sessions(session_id);
    CREATE INDEX ix_diag_sessions_sha ON central.diag_sessions(product_sha) WHERE product_sha IS NOT NULL;
END
GO

IF OBJECT_ID(N'central.diag_events') IS NULL
BEGIN
    CREATE TABLE central.diag_events (
        session_sk           int           NOT NULL REFERENCES central.diag_sessions(session_sk),
        seq                  bigint        NOT NULL,
        upload_batch_id      bigint        NOT NULL,
        event_id             nvarchar(80)  NOT NULL,
        epoch_ms             bigint        NOT NULL,
        event_time_utc       datetime2(3)  NOT NULL,
        monotonic_ns         nvarchar(40)  NULL,
        process              nvarchar(40)  NOT NULL
            CHECK (process IN (N'extensionHost', N'webview', N'renderer', N'sqlToolsService',
                               N'sqlServer', N'harness', N'system')),
        pid                  int           NULL,
        feature              nvarchar(80)  NOT NULL,
        kind                 nvarchar(40)  NOT NULL
            CHECK (kind IN (N'event', N'span', N'metric', N'request', N'response',
                            N'sqlActivity', N'renderPhase', N'gap', N'state')),
        type                 nvarchar(200) NOT NULL,
        status               nvarchar(40)  NOT NULL
            CHECK (status IN (N'ok', N'info', N'warning', N'error', N'blocked', N'partial')),
        trace_id             nvarchar(80)  NULL,
        cause_event_id       nvarchar(80)  NULL,
        entity_kind          nvarchar(40)  NULL,
        entity_ref           nvarchar(200) NULL,
        duration_ms          float         NULL,
        timing_class         nvarchar(60)  NULL
            CHECK (timing_class IS NULL OR timing_class IN
                   (N'officialSameProcess', N'productTimer', N'epochAlignedDiagnostic',
                    N'collectorDiagnostic', N'inferred')),
        cls_max              nvarchar(80)  NOT NULL,
        cls_rank             int           NOT NULL,
        cls_redacted_fields  int           NOT NULL DEFAULT 0,
        tags_json            nvarchar(400) NULL,
        payload_json         nvarchar(max) NOT NULL CHECK (ISJSON(payload_json) = 1),
        payload_digest       nvarchar(100) NOT NULL,
        CONSTRAINT pk_diag_events PRIMARY KEY (session_sk, seq)
    );
    CREATE INDEX ix_diag_events_feature_type_time
        ON central.diag_events(feature, type, event_time_utc DESC)
        INCLUDE (status, duration_ms, trace_id, session_sk, seq);
    CREATE INDEX ix_diag_events_trace
        ON central.diag_events(trace_id, event_time_utc, session_sk, seq)
        WHERE trace_id IS NOT NULL;
    CREATE INDEX ix_diag_events_status_time
        ON central.diag_events(status, event_time_utc DESC)
        INCLUDE (feature, type, duration_ms);
    CREATE INDEX ix_diag_events_batch ON central.diag_events(upload_batch_id);
END
GO

/* Maintenance/audit log for retention runs, purges, migrations. */
IF OBJECT_ID(N'central.maintenance_log') IS NULL
BEGIN
    CREATE TABLE central.maintenance_log (
        maintenance_id   bigint IDENTITY(1,1) PRIMARY KEY,
        action           nvarchar(60)  NOT NULL,
        details_json     nvarchar(max) NOT NULL DEFAULT N'{}' CHECK (ISJSON(details_json) = 1),
        at_utc           datetime2(3)  NOT NULL DEFAULT sysutcdatetime()
    );
END
GO

IF OBJECT_ID(N'central.diag_gaps') IS NULL
BEGIN
    CREATE TABLE central.diag_gaps (
        session_sk           int           NOT NULL REFERENCES central.diag_sessions(session_sk),
        gap_id               nvarchar(80)  NOT NULL,
        upload_batch_id      bigint        NOT NULL,
        from_seq             bigint        NOT NULL,
        through_seq          bigint        NOT NULL,
        dropped_count        int           NOT NULL,
        reason               nvarchar(40)  NOT NULL
            CHECK (reason IN (N'subscriberOverflow', N'sinkOverflow', N'journalUnavailable')),
        backfill_status      nvarchar(20)  NOT NULL
            CHECK (backfill_status IN (N'notStarted', N'running', N'succeeded', N'partial', N'failed')),
        first_available_seq  bigint        NULL,
        epoch_ms             bigint        NOT NULL,
        gap_time_utc         datetime2(3)  NOT NULL,
        CONSTRAINT pk_diag_gaps PRIMARY KEY (session_sk, gap_id)
    );
    CREATE INDEX ix_diag_gaps_batch ON central.diag_gaps(upload_batch_id);
END
GO
