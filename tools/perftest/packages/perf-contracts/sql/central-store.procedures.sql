/* ============================================================================
   Central observability store — ingestion / admin procedures
   (central design §6.4, review addendum C-1/C-2/C-3, §3, Appendix C).

   Writers execute ONLY these procedures — base tables stay write-protected
   (roles.sql). No MERGE anywhere (decision 4). The disposition algebra is
   decided at usp_begin_upload under an applock on the entity key, and
   re-checked at usp_commit_upload (double-checked locking).

   Error numbers: 53001+ (safe reason text only; never payload content).
   ============================================================================ */

/* ---------------------------------------------------------------------------
   usp_ensure_uploader — upsert an uploader row by (kind, digest)
   --------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE central.usp_ensure_uploader
    @principal_kind   nvarchar(30),
    @principal_digest nvarchar(80),
    @display_name     nvarchar(200) = NULL,
    @is_ci            bit = 0,
    @uploader_id      bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SELECT @uploader_id = uploader_id
    FROM central.uploaders WITH (UPDLOCK, HOLDLOCK)
    WHERE principal_kind = @principal_kind AND principal_digest = @principal_digest;

    IF @uploader_id IS NULL
    BEGIN
        INSERT INTO central.uploaders (principal_kind, principal_digest, display_name, is_ci, last_seen_utc)
        VALUES (@principal_kind, @principal_digest, @display_name, @is_ci, sysutcdatetime());
        SET @uploader_id = SCOPE_IDENTITY();
    END
    ELSE
    BEGIN
        UPDATE central.uploaders
        SET last_seen_utc = sysutcdatetime(),
            display_name = COALESCE(@display_name, display_name)
        WHERE uploader_id = @uploader_id;
    END
END
GO

/* ---------------------------------------------------------------------------
   usp_begin_upload — decide the disposition under the entity lock (C-2).

   Returns ONE row:
     disposition        proceed | resume | alreadyPresent | refused
     upload_batch_id    batch to stage into (proceed/resume) or NULL
     reason_code        refusal reason or NULL
     applied_items_json JSON array [{item_kind,item_ordinal,payload_digest}]
                        of already-applied items (resume), else '[]'
   --------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE central.usp_begin_upload
    @source_kind        nvarchar(30),
    @natural_key        nvarchar(200),
    @source_digest      nvarchar(100),
    @content_digest     nvarchar(100),
    @projection_digest  nvarchar(100),
    @preview_digest     nvarchar(100),
    @contract_version   nvarchar(40),
    @projector_version  nvarchar(80),
    @upload_policy_id   nvarchar(120),
    @tool               nvarchar(60),
    @tool_version       nvarchar(60),
    @principal_kind     nvarchar(30),
    @principal_digest   nvarchar(80),
    @display_name       nvarchar(200) = NULL,
    @is_ci              bit = 0,
    @source_summary_json nvarchar(max) = N'{}',
    @dropped_counts_json nvarchar(max) = N'{}',
    @digested_counts_json nvarchar(max) = N'{}'
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;

    DECLARE @uploader_id bigint;
    EXEC central.usp_ensure_uploader @principal_kind, @principal_digest, @display_name, @is_ci, @uploader_id OUTPUT;

    BEGIN TRAN;

    DECLARE @lock_resource nvarchar(255) =
        N'central:' + @source_kind + N':' +
        LOWER(CONVERT(nvarchar(64), HASHBYTES('SHA2_256', CAST(@natural_key AS varbinary(400))), 2));
    DECLARE @lock_result int;
    EXEC @lock_result = sp_getapplock @Resource = @lock_resource, @LockMode = 'Exclusive',
                                      @LockOwner = 'Transaction', @LockTimeout = 15000;
    IF @lock_result < 0
    BEGIN
        ROLLBACK TRAN;
        THROW 53001, N'usp_begin_upload: could not acquire entity lock', 1;
    END

    DECLARE @e_source nvarchar(100), @e_content nvarchar(100), @e_projection nvarchar(100),
            @e_contract nvarchar(40), @e_projector nvarchar(80), @e_policy nvarchar(120),
            @e_purged datetime2(3), @e_entity_id bigint;
    SELECT @e_entity_id = entity_id, @e_source = source_digest, @e_content = content_digest,
           @e_projection = projection_digest, @e_contract = contract_version,
           @e_projector = projector_version, @e_policy = upload_policy_id, @e_purged = purged_at_utc
    FROM central.central_entities WITH (UPDLOCK, HOLDLOCK)
    WHERE kind = @source_kind AND natural_key = @natural_key;

    DECLARE @disposition nvarchar(30) = NULL, @reason nvarchar(200) = NULL,
            @batch_id bigint = NULL, @applied nvarchar(max) = N'[]';

    IF @e_entity_id IS NOT NULL AND @e_purged IS NULL
    BEGIN
        IF @e_source = @source_digest
        BEGIN
            IF @e_contract = @contract_version AND @e_projector = @projector_version
               AND @e_policy = @upload_policy_id
            BEGIN
                IF @e_projection = @projection_digest
                    SET @disposition = N'alreadyPresent';
                ELSE
                BEGIN
                    -- Same source, same projector, same policy, different rows:
                    -- projector nondeterminism — unambiguously a bug signal (C-1).
                    SET @disposition = N'refused';
                    SET @reason = N'projectionMismatch';
                END
            END
            -- Different projector or policy over the same source truth: a
            -- legitimate re-projection (proceeds; commit records 'reprojected').
        END
        ELSE
        BEGIN
            SET @disposition = N'refused';
            SET @reason = N'sourceMutation';
        END
    END

    IF @disposition IS NULL
    BEGIN
        -- Resume: a prior 'started' batch for the same key, digests and writer
        -- identity continues instead of starting over (C-2).
        SELECT TOP (1) @batch_id = b.upload_batch_id
        FROM central.upload_batches b
        WHERE b.source_kind = @source_kind AND b.natural_key = @natural_key
          AND b.status = N'started'
          AND b.source_digest = @source_digest AND b.projection_digest = @projection_digest
          AND b.contract_version = @contract_version AND b.projector_version = @projector_version
          AND b.upload_policy_id = @upload_policy_id AND b.uploader_id = @uploader_id
        ORDER BY b.upload_batch_id DESC;

        IF @batch_id IS NOT NULL
        BEGIN
            SET @disposition = N'resume';
            SET @applied = (
                SELECT item_kind, item_ordinal, payload_digest
                FROM central.upload_items
                WHERE upload_batch_id = @batch_id AND status = N'applied'
                FOR JSON PATH, INCLUDE_NULL_VALUES
            );
            IF @applied IS NULL SET @applied = N'[]';
        END
        ELSE
        BEGIN
            SET @disposition = N'proceed';
            INSERT INTO central.upload_batches
                (uploader_id, tool, tool_version, contract_version, projector_version,
                 upload_policy_id, source_kind, natural_key, source_digest, content_digest,
                 projection_digest, preview_digest, status, source_summary_json,
                 dropped_counts_json, digested_counts_json)
            VALUES
                (@uploader_id, @tool, @tool_version, @contract_version, @projector_version,
                 @upload_policy_id, @source_kind, @natural_key, @source_digest, @content_digest,
                 @projection_digest, @preview_digest, N'started', @source_summary_json,
                 @dropped_counts_json, @digested_counts_json);
            SET @batch_id = SCOPE_IDENTITY();
        END
    END
    ELSE IF @disposition IN (N'alreadyPresent', N'refused')
    BEGIN
        -- Ledger the attempt: evidence, not analysis rows.
        INSERT INTO central.upload_batches
            (uploader_id, tool, tool_version, contract_version, projector_version,
             upload_policy_id, source_kind, natural_key, source_digest, content_digest,
             projection_digest, preview_digest, status, outcome_reason, source_summary_json)
        VALUES
            (@uploader_id, @tool, @tool_version, @contract_version, @projector_version,
             @upload_policy_id, @source_kind, @natural_key, @source_digest, @content_digest,
             @projection_digest, @preview_digest, @disposition, @reason, @source_summary_json);
    END

    COMMIT TRAN;

    SELECT @disposition AS disposition, @batch_id AS upload_batch_id,
           @reason AS reason_code, @applied AS applied_items_json;
END
GO

/* ---------------------------------------------------------------------------
   usp_stage_upload_item — shred one projected item into its kind table.
   Idempotent: identical (batch, kind, ordinal, digest) already applied is a
   no-op returning 'applied'. diag_sessions must be staged before diag_events
   or diag_gaps (session_sk resolution).
   --------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE central.usp_stage_upload_item
    @upload_batch_id  bigint,
    @item_kind        nvarchar(50),
    @item_ordinal     int,
    @row_count        int,
    @payload_digest   nvarchar(100),
    @payload          nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;

    DECLARE @status nvarchar(30), @policy nvarchar(120);
    SELECT @status = status, @policy = upload_policy_id
    FROM central.upload_batches WHERE upload_batch_id = @upload_batch_id;
    IF @status IS NULL
        THROW 53002, N'usp_stage_upload_item: unknown batch', 1;
    IF @status <> N'started'
        THROW 53003, N'usp_stage_upload_item: batch is not in started state', 1;
    IF ISJSON(@payload) <> 1
        THROW 53004, N'usp_stage_upload_item: payload is not valid JSON', 1;

    -- Idempotent resume: same slice already applied → no-op.
    IF EXISTS (SELECT 1 FROM central.upload_items
               WHERE upload_batch_id = @upload_batch_id AND item_kind = @item_kind
                 AND item_ordinal = @item_ordinal AND payload_digest = @payload_digest
                 AND status = N'applied')
    BEGIN
        SELECT N'applied' AS item_status, 0 AS rows_inserted;
        RETURN;
    END

    BEGIN TRAN;

    -- A retry supersedes a previous failed/staged attempt at the same slot.
    DELETE FROM central.upload_items
    WHERE upload_batch_id = @upload_batch_id AND item_kind = @item_kind
      AND item_ordinal = @item_ordinal AND status <> N'applied';

    INSERT INTO central.upload_items (upload_batch_id, item_kind, item_ordinal, row_count, payload_digest, status)
    VALUES (@upload_batch_id, @item_kind, @item_ordinal, @row_count, @payload_digest, N'staged');
    DECLARE @item_id bigint = SCOPE_IDENTITY();

    DECLARE @inserted int = 0;

    IF @item_kind = N'runs'
    BEGIN
        INSERT INTO central.runs (upload_batch_id, run_id, created_at_unix_ns, created_at_utc,
                                  pass_type, status, config_hash, environment_hash, machine_id, notes)
        SELECT @upload_batch_id, j.run_id, j.created_at_unix_ns, j.created_at_utc,
               j.pass_type, j.status, j.config_hash, j.environment_hash, j.machine_id, j.notes
        FROM OPENJSON(@payload) WITH (
            run_id nvarchar(100), created_at_unix_ns nvarchar(30), created_at_utc datetime2(3),
            pass_type nvarchar(20), status nvarchar(20), config_hash nvarchar(100),
            environment_hash nvarchar(100), machine_id nvarchar(200), notes nvarchar(max)
        ) j;
        SET @inserted = @@ROWCOUNT;
    END
    ELSE IF @item_kind = N'run_repositories'
    BEGIN
        INSERT INTO central.run_repositories (upload_batch_id, run_id, repo, sha, branch, dirty, remote)
        SELECT @upload_batch_id, j.run_id, j.repo, j.sha, j.branch, j.dirty, j.remote
        FROM OPENJSON(@payload) WITH (
            run_id nvarchar(100), repo nvarchar(200), sha nvarchar(80),
            branch nvarchar(200), dirty bit, remote nvarchar(400)
        ) j;
        SET @inserted = @@ROWCOUNT;
    END
    ELSE IF @item_kind = N'environments'
    BEGIN
        INSERT INTO central.environments (upload_batch_id, environment_hash, captured_at_unix_ns,
            captured_at_utc, machine_id, os_platform, os_version, cpu_model, logical_cores,
            memory_total_mb, vscode_version, extension_versions_json, sts_version,
            sql_image_digest, sql_snapshot, config_fingerprint_json)
        SELECT @upload_batch_id, j.environment_hash, j.captured_at_unix_ns, j.captured_at_utc,
               j.machine_id, j.os_platform, j.os_version, j.cpu_model, j.logical_cores,
               j.memory_total_mb, j.vscode_version, j.extension_versions_json, j.sts_version,
               j.sql_image_digest, j.sql_snapshot, j.config_fingerprint_json
        FROM OPENJSON(@payload) WITH (
            environment_hash nvarchar(100), captured_at_unix_ns nvarchar(30), captured_at_utc datetime2(3),
            machine_id nvarchar(200), os_platform nvarchar(60), os_version nvarchar(200),
            cpu_model nvarchar(200), logical_cores int, memory_total_mb int,
            vscode_version nvarchar(60), extension_versions_json nvarchar(max),
            sts_version nvarchar(60), sql_image_digest nvarchar(200), sql_snapshot nvarchar(200),
            config_fingerprint_json nvarchar(max)
        ) j;
        SET @inserted = @@ROWCOUNT;
    END
    ELSE IF @item_kind = N'scenarios'
    BEGIN
        INSERT INTO central.scenarios (upload_batch_id, scenario_id, display_name, owner, tags_json, definition_hash)
        SELECT @upload_batch_id, j.scenario_id, j.display_name, j.owner, j.tags_json, j.definition_hash
        FROM OPENJSON(@payload) WITH (
            scenario_id nvarchar(200), display_name nvarchar(400), owner nvarchar(200),
            tags_json nvarchar(max), definition_hash nvarchar(100)
        ) j;
        SET @inserted = @@ROWCOUNT;
    END
    ELSE IF @item_kind = N'repetitions'
    BEGIN
        INSERT INTO central.repetitions (upload_batch_id, run_id, scenario_id, rep_id, attempt_id,
                                         status, warmup, trace_id, start_unix_ns, end_unix_ns, start_utc, end_utc)
        SELECT @upload_batch_id, j.run_id, j.scenario_id, j.rep_id, j.attempt_id,
               j.status, j.warmup, j.trace_id, j.start_unix_ns, j.end_unix_ns, j.start_utc, j.end_utc
        FROM OPENJSON(@payload) WITH (
            run_id nvarchar(100), scenario_id nvarchar(200), rep_id int, attempt_id int,
            status nvarchar(20), warmup bit, trace_id nvarchar(80),
            start_unix_ns nvarchar(30), end_unix_ns nvarchar(30),
            start_utc datetime2(3), end_utc datetime2(3)
        ) j;
        SET @inserted = @@ROWCOUNT;
    END
    ELSE IF @item_kind = N'metrics'
    BEGIN
        INSERT INTO central.metrics (upload_batch_id, run_id, scenario_id, rep_id, attempt_id,
            name, value, unit, component, process_role, source, official, lower_is_better,
            aggregation, trace_id, span_id, start_unix_ns, end_unix_ns, confidence, tags_json, derivation_json)
        SELECT @upload_batch_id, j.run_id, j.scenario_id, j.rep_id, j.attempt_id,
               j.name, j.value, j.unit, j.component, j.process_role, j.source, j.official,
               j.lower_is_better, j.aggregation, j.trace_id, j.span_id, j.start_unix_ns,
               j.end_unix_ns, j.confidence, j.tags_json, j.derivation_json
        FROM OPENJSON(@payload) WITH (
            run_id nvarchar(100), scenario_id nvarchar(200), rep_id int, attempt_id int,
            name nvarchar(200), value float, unit nvarchar(40), component nvarchar(80),
            process_role nvarchar(80), source nvarchar(40), official bit, lower_is_better bit,
            aggregation nvarchar(40), trace_id nvarchar(80), span_id nvarchar(40),
            start_unix_ns nvarchar(30), end_unix_ns nvarchar(30), confidence nvarchar(20),
            tags_json nvarchar(max), derivation_json nvarchar(max)
        ) j;
        SET @inserted = @@ROWCOUNT;
    END
    ELSE IF @item_kind = N'validations'
    BEGIN
        INSERT INTO central.validations (upload_batch_id, run_id, scenario_id, rep_id, attempt_id,
                                         name, status, message, details_json)
        SELECT @upload_batch_id, j.run_id, j.scenario_id, j.rep_id, j.attempt_id,
               j.name, j.status, j.message, j.details_json
        FROM OPENJSON(@payload) WITH (
            run_id nvarchar(100), scenario_id nvarchar(200), rep_id int, attempt_id int,
            name nvarchar(200), status nvarchar(20), message nvarchar(max), details_json nvarchar(max)
        ) j;
        SET @inserted = @@ROWCOUNT;
    END
    ELSE IF @item_kind = N'artifact_refs'
    BEGIN
        INSERT INTO central.artifact_refs (upload_batch_id, run_id, scenario_id, rep_id, attempt_id,
            kind, relative_path, retention, size_bytes, sha256, content_type, created_at_unix_ns, created_at_utc)
        SELECT @upload_batch_id, j.run_id, j.scenario_id, j.rep_id, j.attempt_id,
               j.kind, j.relative_path, j.retention, j.size_bytes, j.sha256, j.content_type,
               j.created_at_unix_ns, j.created_at_utc
        FROM OPENJSON(@payload) WITH (
            run_id nvarchar(100), scenario_id nvarchar(200), rep_id int, attempt_id int,
            kind nvarchar(80), relative_path nvarchar(400), retention nvarchar(20),
            size_bytes bigint, sha256 nvarchar(80), content_type nvarchar(120),
            created_at_unix_ns nvarchar(30), created_at_utc datetime2(3)
        ) j;
        SET @inserted = @@ROWCOUNT;
    END
    ELSE IF @item_kind = N'diag_sessions'
    BEGIN
        INSERT INTO central.diag_sessions (upload_batch_id, session_id, source, capture_mode,
            capture_policy_id, upload_policy_id, created_utc, updated_utc, event_count, gap_count,
            source_size_bytes, provenance_json, environment_hash, product_sha, status)
        SELECT @upload_batch_id, j.session_id, j.source, j.capture_mode,
               j.capture_policy_id, @policy, j.created_utc, j.updated_utc, j.event_count, j.gap_count,
               j.source_size_bytes, j.provenance_json, j.environment_hash, j.product_sha, j.status
        FROM OPENJSON(@payload) WITH (
            session_id nvarchar(100), source nvarchar(30), capture_mode nvarchar(40),
            capture_policy_id nvarchar(120), created_utc datetime2(3), updated_utc datetime2(3),
            event_count int, gap_count int, source_size_bytes bigint,
            provenance_json nvarchar(max), environment_hash nvarchar(100),
            product_sha nvarchar(80), status nvarchar(20)
        ) j;
        SET @inserted = @@ROWCOUNT;
    END
    ELSE IF @item_kind IN (N'diag_events', N'diag_gaps')
    BEGIN
        DECLARE @session_sk int;
        SELECT @session_sk = session_sk FROM central.diag_sessions
        WHERE upload_batch_id = @upload_batch_id;
        IF @session_sk IS NULL
        BEGIN
            ROLLBACK TRAN;
            THROW 53005, N'usp_stage_upload_item: diag_sessions item must be staged before events/gaps', 1;
        END

        IF @item_kind = N'diag_events'
        BEGIN
            INSERT INTO central.diag_events (session_sk, seq, upload_batch_id, event_id, epoch_ms,
                event_time_utc, monotonic_ns, process, pid, feature, kind, type, status, trace_id,
                cause_event_id, entity_kind, entity_ref, duration_ms, timing_class, cls_max,
                cls_rank, cls_redacted_fields, tags_json, payload_json, payload_digest)
            SELECT @session_sk, j.seq, @upload_batch_id, j.event_id, j.epoch_ms,
                   j.event_time_utc, j.monotonic_ns, j.process, j.pid, j.feature, j.kind, j.type,
                   j.status, j.trace_id, j.cause_event_id, j.entity_kind, j.entity_ref,
                   j.duration_ms, j.timing_class, j.cls_max, j.cls_rank, j.cls_redacted_fields,
                   j.tags_json, j.payload_json, j.payload_digest
            FROM OPENJSON(@payload) WITH (
                seq bigint, event_id nvarchar(80), epoch_ms bigint, event_time_utc datetime2(3),
                monotonic_ns nvarchar(40), process nvarchar(40), pid int, feature nvarchar(80),
                kind nvarchar(40), type nvarchar(200), status nvarchar(40), trace_id nvarchar(80),
                cause_event_id nvarchar(80), entity_kind nvarchar(40), entity_ref nvarchar(200),
                duration_ms float, timing_class nvarchar(60), cls_max nvarchar(80), cls_rank int,
                cls_redacted_fields int, tags_json nvarchar(max),
                payload_json nvarchar(max), payload_digest nvarchar(100)
            ) j;
            SET @inserted = @@ROWCOUNT;
        END
        ELSE
        BEGIN
            INSERT INTO central.diag_gaps (session_sk, gap_id, upload_batch_id, from_seq, through_seq,
                dropped_count, reason, backfill_status, first_available_seq, epoch_ms, gap_time_utc)
            SELECT @session_sk, j.gap_id, @upload_batch_id, j.from_seq, j.through_seq,
                   j.dropped_count, j.reason, j.backfill_status, j.first_available_seq,
                   j.epoch_ms, j.gap_time_utc
            FROM OPENJSON(@payload) WITH (
                gap_id nvarchar(80), from_seq bigint, through_seq bigint, dropped_count int,
                reason nvarchar(40), backfill_status nvarchar(20), first_available_seq bigint,
                epoch_ms bigint, gap_time_utc datetime2(3)
            ) j;
            SET @inserted = @@ROWCOUNT;
        END
    END
    ELSE
    BEGIN
        ROLLBACK TRAN;
        THROW 53006, N'usp_stage_upload_item: unknown item_kind', 1;
    END

    IF @inserted <> @row_count
    BEGIN
        -- Roll back the staged rows, then record the failure as ledger
        -- evidence in its own right (the rolled-back item row is gone).
        ROLLBACK TRAN;
        INSERT INTO central.upload_items
            (upload_batch_id, item_kind, item_ordinal, row_count, payload_digest, status, error_code, error_message)
        VALUES
            (@upload_batch_id, @item_kind, @item_ordinal, @row_count, @payload_digest, N'failed',
             N'rowCountMismatch',
             N'inserted ' + CAST(@inserted AS nvarchar(20)) + N' of ' + CAST(@row_count AS nvarchar(20)));
        THROW 53007, N'usp_stage_upload_item: inserted row count does not match declared row_count', 1;
    END

    UPDATE central.upload_items SET status = N'applied' WHERE upload_item_id = @item_id;
    COMMIT TRAN;

    SELECT N'applied' AS item_status, @inserted AS rows_inserted;
END
GO

/* ---------------------------------------------------------------------------
   usp_commit_upload — verify accounting (H-3), re-check disposition under the
   lock, flip the entity pointer, stamp the batch. Returns the receipt row.
   --------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE central.usp_commit_upload
    @upload_batch_id     bigint,
    @expected_items      int,
    @expected_rows_json  nvarchar(max)   -- {"runs":1,"metrics":120,...}
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;

    DECLARE @kind nvarchar(30), @natural_key nvarchar(200), @status nvarchar(30),
            @source_digest nvarchar(100), @content_digest nvarchar(100),
            @projection_digest nvarchar(100), @preview_digest nvarchar(100),
            @contract nvarchar(40), @projector nvarchar(80), @policy nvarchar(120);
    SELECT @kind = source_kind, @natural_key = natural_key, @status = status,
           @source_digest = source_digest, @content_digest = content_digest,
           @projection_digest = projection_digest, @preview_digest = preview_digest,
           @contract = contract_version, @projector = projector_version, @policy = upload_policy_id
    FROM central.upload_batches WHERE upload_batch_id = @upload_batch_id;

    IF @status IS NULL THROW 53010, N'usp_commit_upload: unknown batch', 1;
    IF @status <> N'started' THROW 53011, N'usp_commit_upload: batch is not in started state', 1;

    -- H-3 accounting outside the lock: items all applied and counts exact.
    IF EXISTS (SELECT 1 FROM central.upload_items
               WHERE upload_batch_id = @upload_batch_id AND status <> N'applied')
        THROW 53012, N'usp_commit_upload: not all items are applied', 1;
    IF (SELECT COUNT(*) FROM central.upload_items WHERE upload_batch_id = @upload_batch_id) <> @expected_items
        THROW 53013, N'usp_commit_upload: item count does not match expected_items', 1;

    DECLARE @mismatch nvarchar(200) = NULL;
    ;WITH expected AS (
        SELECT [key] COLLATE DATABASE_DEFAULT AS item_kind, TRY_CONVERT(int, [value]) AS expected_rows
        FROM OPENJSON(@expected_rows_json)
    ), staged AS (
        SELECT item_kind, SUM(row_count) AS staged_rows
        FROM central.upload_items WHERE upload_batch_id = @upload_batch_id
        GROUP BY item_kind
    ), actual AS (
        SELECT N'runs' AS item_kind, COUNT(*) AS actual_rows FROM central.runs WHERE upload_batch_id = @upload_batch_id
        UNION ALL SELECT N'run_repositories', COUNT(*) FROM central.run_repositories WHERE upload_batch_id = @upload_batch_id
        UNION ALL SELECT N'environments', COUNT(*) FROM central.environments WHERE upload_batch_id = @upload_batch_id
        UNION ALL SELECT N'scenarios', COUNT(*) FROM central.scenarios WHERE upload_batch_id = @upload_batch_id
        UNION ALL SELECT N'repetitions', COUNT(*) FROM central.repetitions WHERE upload_batch_id = @upload_batch_id
        UNION ALL SELECT N'metrics', COUNT(*) FROM central.metrics WHERE upload_batch_id = @upload_batch_id
        UNION ALL SELECT N'validations', COUNT(*) FROM central.validations WHERE upload_batch_id = @upload_batch_id
        UNION ALL SELECT N'artifact_refs', COUNT(*) FROM central.artifact_refs WHERE upload_batch_id = @upload_batch_id
        UNION ALL SELECT N'diag_sessions', COUNT(*) FROM central.diag_sessions WHERE upload_batch_id = @upload_batch_id
        UNION ALL SELECT N'diag_events', COUNT(*) FROM central.diag_events WHERE upload_batch_id = @upload_batch_id
        UNION ALL SELECT N'diag_gaps', COUNT(*) FROM central.diag_gaps WHERE upload_batch_id = @upload_batch_id
    )
    SELECT TOP (1) @mismatch = a.item_kind
    FROM actual a
    FULL OUTER JOIN staged s ON s.item_kind = a.item_kind
    FULL OUTER JOIN expected e ON e.item_kind = COALESCE(a.item_kind, s.item_kind)
    WHERE COALESCE(a.actual_rows, 0) <> COALESCE(s.staged_rows, 0)
       OR COALESCE(s.staged_rows, 0) <> COALESCE(e.expected_rows, 0);
    IF @mismatch IS NOT NULL
        THROW 53014, N'usp_commit_upload: row accounting mismatch between expected, staged and actual', 1;

    BEGIN TRAN;

    DECLARE @lock_resource nvarchar(255) =
        N'central:' + @kind + N':' +
        LOWER(CONVERT(nvarchar(64), HASHBYTES('SHA2_256', CAST(@natural_key AS varbinary(400))), 2));
    DECLARE @lock_result int;
    EXEC @lock_result = sp_getapplock @Resource = @lock_resource, @LockMode = 'Exclusive',
                                      @LockOwner = 'Transaction', @LockTimeout = 15000;
    IF @lock_result < 0
    BEGIN
        ROLLBACK TRAN;
        THROW 53015, N'usp_commit_upload: could not acquire entity lock', 1;
    END

    DECLARE @outcome nvarchar(30) = N'committed';
    DECLARE @e_entity_id bigint, @e_source nvarchar(100), @e_projection nvarchar(100),
            @e_contract nvarchar(40), @e_projector nvarchar(80), @e_policy nvarchar(120),
            @e_purged datetime2(3);
    SELECT @e_entity_id = entity_id, @e_source = source_digest, @e_projection = projection_digest,
           @e_contract = contract_version, @e_projector = projector_version,
           @e_policy = upload_policy_id, @e_purged = purged_at_utc
    FROM central.central_entities WITH (UPDLOCK, HOLDLOCK)
    WHERE kind = @kind AND natural_key = @natural_key;

    IF @e_entity_id IS NULL
    BEGIN
        INSERT INTO central.central_entities (kind, natural_key, current_batch_id, contract_version,
            projector_version, source_digest, content_digest, projection_digest, upload_policy_id,
            environment_hash, product_sha)
        SELECT @kind, @natural_key, @upload_batch_id, @contract, @projector,
               @source_digest, @content_digest, @projection_digest, @policy,
               env.environment_hash, sha.product_sha
        FROM (SELECT 1 AS one) AS x
        OUTER APPLY (SELECT TOP (1) environment_hash FROM central.runs WHERE upload_batch_id = @upload_batch_id
                     UNION ALL SELECT TOP (1) environment_hash FROM central.diag_sessions WHERE upload_batch_id = @upload_batch_id) env
        OUTER APPLY (SELECT TOP (1) product_sha FROM central.diag_sessions WHERE upload_batch_id = @upload_batch_id) sha;
        SET @outcome = N'committed';
    END
    ELSE IF @e_purged IS NOT NULL
    BEGIN
        -- Re-upload of a purged entity: allowed, becomes the new current truth.
        UPDATE central.central_entities
        SET current_batch_id = @upload_batch_id, contract_version = @contract,
            projector_version = @projector, source_digest = @source_digest,
            content_digest = @content_digest, projection_digest = @projection_digest,
            upload_policy_id = @policy, purged_at_utc = NULL, updated_at_utc = sysutcdatetime()
        WHERE entity_id = @e_entity_id;
        SET @outcome = N'committed';
    END
    ELSE IF @e_source = @source_digest
         AND @e_contract = @contract AND @e_projector = @projector AND @e_policy = @policy
         AND @e_projection = @projection_digest
    BEGIN
        -- A racing writer committed the identical projection while we staged.
        SET @outcome = N'alreadyPresent';
    END
    ELSE IF @e_source = @source_digest
    BEGIN
        -- Legitimate re-projection (newer projector or different policy).
        UPDATE central.central_entities
        SET current_batch_id = @upload_batch_id, contract_version = @contract,
            projector_version = @projector, content_digest = @content_digest,
            projection_digest = @projection_digest, upload_policy_id = @policy,
            updated_at_utc = sysutcdatetime()
        WHERE entity_id = @e_entity_id;
        SET @outcome = CASE WHEN @e_projector = @projector AND @e_contract = @contract AND @e_policy = @policy
                            THEN N'committed' ELSE N'reprojected' END;
    END
    ELSE
    BEGIN
        -- Source mutated under the key between begin and commit.
        UPDATE central.upload_batches
        SET status = N'refused', outcome_reason = N'sourceMutation'
        WHERE upload_batch_id = @upload_batch_id;
        COMMIT TRAN;
        SELECT @upload_batch_id AS upload_batch_id, N'refused' AS outcome, N'sourceMutation' AS reason_code,
               @kind AS source_kind, @natural_key AS natural_key, @policy AS upload_policy_id,
               NULL AS row_counts_json, @source_digest AS source_digest, @content_digest AS content_digest,
               @projection_digest AS projection_digest, @preview_digest AS preview_digest,
               NULL AS committed_at_utc;
        RETURN;
    END

    DECLARE @row_counts nvarchar(max) = (
        SELECT item_kind, SUM(row_count) AS rows
        FROM central.upload_items WHERE upload_batch_id = @upload_batch_id
        GROUP BY item_kind FOR JSON PATH
    );
    IF @row_counts IS NULL SET @row_counts = N'[]';

    DECLARE @committed_at datetime2(3) = sysutcdatetime();
    UPDATE central.upload_batches
    SET status = @outcome, row_counts_json = @row_counts, committed_at_utc = @committed_at
    WHERE upload_batch_id = @upload_batch_id;

    COMMIT TRAN;

    SELECT @upload_batch_id AS upload_batch_id, @outcome AS outcome, NULL AS reason_code,
           @kind AS source_kind, @natural_key AS natural_key, @policy AS upload_policy_id,
           @row_counts AS row_counts_json, @source_digest AS source_digest,
           @content_digest AS content_digest, @projection_digest AS projection_digest,
           @preview_digest AS preview_digest, @committed_at AS committed_at_utc;
END
GO

/* ---------------------------------------------------------------------------
   usp_abort_upload — abandoned | failed | refused (refusedByPolicy lane)
   --------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE central.usp_abort_upload
    @upload_batch_id bigint,
    @final_status    nvarchar(30),   -- abandoned | failed | refused
    @reason_code     nvarchar(200) = NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @final_status NOT IN (N'abandoned', N'failed', N'refused')
        THROW 53020, N'usp_abort_upload: final_status must be abandoned, failed, or refused', 1;
    UPDATE central.upload_batches
    SET status = @final_status, outcome_reason = @reason_code
    WHERE upload_batch_id = @upload_batch_id AND status = N'started';
    IF @@ROWCOUNT = 0
        THROW 53021, N'usp_abort_upload: batch not found or not in started state', 1;
    SELECT @upload_batch_id AS upload_batch_id, @final_status AS outcome, @reason_code AS reason_code;
END
GO

/* ---------------------------------------------------------------------------
   usp_purge_entity — delete kind rows, mark entity purged, keep safe audit
   --------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE central.usp_purge_entity
    @kind                   nvarchar(30),
    @natural_key            nvarchar(200),
    @reason                 nvarchar(200),
    @clear_uploader_display bit = 0
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRAN;

    DECLARE @entity_id bigint;
    SELECT @entity_id = entity_id FROM central.central_entities WITH (UPDLOCK, HOLDLOCK)
    WHERE kind = @kind AND natural_key = @natural_key;
    IF @entity_id IS NULL
    BEGIN
        ROLLBACK TRAN;
        THROW 53030, N'usp_purge_entity: entity not found', 1;
    END

    DECLARE @batches TABLE (upload_batch_id bigint PRIMARY KEY);
    INSERT INTO @batches SELECT upload_batch_id FROM central.upload_batches
    WHERE source_kind = @kind AND natural_key = @natural_key;

    DELETE e FROM central.diag_events e JOIN @batches b ON b.upload_batch_id = e.upload_batch_id;
    DELETE g FROM central.diag_gaps g JOIN @batches b ON b.upload_batch_id = g.upload_batch_id;
    DELETE s FROM central.diag_sessions s JOIN @batches b ON b.upload_batch_id = s.upload_batch_id;
    DELETE m FROM central.metrics m JOIN @batches b ON b.upload_batch_id = m.upload_batch_id;
    DELETE v FROM central.validations v JOIN @batches b ON b.upload_batch_id = v.upload_batch_id;
    DELETE a FROM central.artifact_refs a JOIN @batches b ON b.upload_batch_id = a.upload_batch_id;
    DELETE r FROM central.repetitions r JOIN @batches b ON b.upload_batch_id = r.upload_batch_id;
    DELETE s FROM central.scenarios s JOIN @batches b ON b.upload_batch_id = s.upload_batch_id;
    DELETE e FROM central.environments e JOIN @batches b ON b.upload_batch_id = e.upload_batch_id;
    DELETE rr FROM central.run_repositories rr JOIN @batches b ON b.upload_batch_id = rr.upload_batch_id;
    DELETE r FROM central.runs r JOIN @batches b ON b.upload_batch_id = r.upload_batch_id;
    DELETE FROM central.baselines WHERE run_id = @natural_key AND @kind = N'perfRun';

    UPDATE b SET status = N'purged', outcome_reason = @reason
    FROM central.upload_batches b JOIN @batches x ON x.upload_batch_id = b.upload_batch_id;

    IF @clear_uploader_display = 1
        UPDATE u SET display_name = NULL
        FROM central.uploaders u
        WHERE u.uploader_id IN (SELECT DISTINCT ub.uploader_id
                                FROM central.upload_batches ub JOIN @batches x ON x.upload_batch_id = ub.upload_batch_id);

    UPDATE central.central_entities SET purged_at_utc = sysutcdatetime(), updated_at_utc = sysutcdatetime()
    WHERE entity_id = @entity_id;

    INSERT INTO central.maintenance_log (action, details_json)
    VALUES (N'purge', (SELECT @kind AS kind, @natural_key AS natural_key, @reason AS reason FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

    COMMIT TRAN;
    SELECT @entity_id AS entity_id, N'purged' AS outcome;
END
GO

/* ---------------------------------------------------------------------------
   usp_set_baseline — CI/admin only (H-5); '' wildcards map SQLite NULLs
   --------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE central.usp_set_baseline
    @baseline_name    nvarchar(120),
    @scenario_id      nvarchar(200) = N'',
    @metric_name      nvarchar(200) = N'',
    @environment_hash nvarchar(100) = N'',
    @run_id           nvarchar(100),
    @principal_kind   nvarchar(30),
    @principal_digest nvarchar(80)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;

    IF IS_ROLEMEMBER(N'central_ci') = 0 AND IS_ROLEMEMBER(N'db_owner') = 0
       AND IS_SRVROLEMEMBER(N'sysadmin') = 0
        THROW 53040, N'usp_set_baseline: caller is not central_ci or admin', 1;

    IF NOT EXISTS (SELECT 1 FROM central.central_entities
                   WHERE kind = N'perfRun' AND natural_key = @run_id AND purged_at_utc IS NULL)
        THROW 53041, N'usp_set_baseline: run is not a committed central entity', 1;

    DECLARE @uploader_id bigint;
    EXEC central.usp_ensure_uploader @principal_kind, @principal_digest, NULL, 1, @uploader_id OUTPUT;

    BEGIN TRAN;
    UPDATE central.baselines WITH (UPDLOCK, HOLDLOCK)
    SET run_id = @run_id, uploader_id = @uploader_id, created_at_utc = sysutcdatetime()
    WHERE baseline_name = @baseline_name AND scenario_id = @scenario_id
      AND metric_name = @metric_name AND environment_hash = @environment_hash;
    IF @@ROWCOUNT = 0
        INSERT INTO central.baselines (baseline_name, scenario_id, metric_name, environment_hash, run_id, uploader_id)
        VALUES (@baseline_name, @scenario_id, @metric_name, @environment_hash, @run_id, @uploader_id);
    COMMIT TRAN;

    SELECT @baseline_name AS baseline_name, @run_id AS run_id;
END
GO

/* ---------------------------------------------------------------------------
   usp_retention_cleanup — TTL lanes + orphan sweep + abandoned promotion
   (H-4, C-3). Runnable by SQL Agent, a scheduled task, or `perftest central
   cleanup`; every lane is bounded and logged.
   --------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE central.usp_retention_cleanup
    @diag_event_days   int = 90,
    @abandon_after_days int = 7,
    @orphan_after_days  int = 7
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;

    DECLARE @now datetime2(3) = sysutcdatetime();
    DECLARE @promoted int = 0, @orphan_batches int = 0, @aged_sessions int = 0, @aged_events bigint = 0;

    -- Lane 1: stale started batches → abandoned.
    UPDATE central.upload_batches
    SET status = N'abandoned', outcome_reason = N'retention: started past abandon window'
    WHERE status = N'started' AND started_at_utc < DATEADD(day, -@abandon_after_days, @now);
    SET @promoted = @@ROWCOUNT;

    -- Lane 2: orphan sweep — kind rows whose batch is not any entity's
    -- current batch and is terminally not-current.
    DECLARE @orphans TABLE (upload_batch_id bigint PRIMARY KEY);
    INSERT INTO @orphans
    SELECT b.upload_batch_id
    FROM central.upload_batches b
    WHERE b.started_at_utc < DATEADD(day, -@orphan_after_days, @now)
      AND b.status IN (N'abandoned', N'failed', N'refused', N'reprojected', N'committed', N'extended')
      AND NOT EXISTS (SELECT 1 FROM central.central_entities e WHERE e.current_batch_id = b.upload_batch_id)
      AND EXISTS (SELECT 1 FROM central.upload_items i WHERE i.upload_batch_id = b.upload_batch_id);
    SET @orphan_batches = (SELECT COUNT(*) FROM @orphans);

    IF @orphan_batches > 0
    BEGIN
        DELETE e FROM central.diag_events e JOIN @orphans o ON o.upload_batch_id = e.upload_batch_id;
        DELETE g FROM central.diag_gaps g JOIN @orphans o ON o.upload_batch_id = g.upload_batch_id;
        DELETE s FROM central.diag_sessions s JOIN @orphans o ON o.upload_batch_id = s.upload_batch_id;
        DELETE m FROM central.metrics m JOIN @orphans o ON o.upload_batch_id = m.upload_batch_id;
        DELETE v FROM central.validations v JOIN @orphans o ON o.upload_batch_id = v.upload_batch_id;
        DELETE a FROM central.artifact_refs a JOIN @orphans o ON o.upload_batch_id = a.upload_batch_id;
        DELETE r FROM central.repetitions r JOIN @orphans o ON o.upload_batch_id = r.upload_batch_id;
        DELETE s FROM central.scenarios s JOIN @orphans o ON o.upload_batch_id = s.upload_batch_id;
        DELETE e FROM central.environments e JOIN @orphans o ON o.upload_batch_id = e.upload_batch_id;
        DELETE rr FROM central.run_repositories rr JOIN @orphans o ON o.upload_batch_id = rr.upload_batch_id;
        DELETE r FROM central.runs r JOIN @orphans o ON o.upload_batch_id = r.upload_batch_id;
        DELETE i FROM central.upload_items i JOIN @orphans o ON o.upload_batch_id = i.upload_batch_id;
    END

    -- Lane 3: diag event/gap detail TTL (whole-session grain via session_sk;
    -- the session manifest row is retained for provenance).
    DECLARE @aged TABLE (session_sk int PRIMARY KEY);
    INSERT INTO @aged
    SELECT s.session_sk FROM central.diag_sessions s
    WHERE s.created_utc < DATEADD(day, -@diag_event_days, @now)
      AND EXISTS (SELECT 1 FROM central.diag_events e WHERE e.session_sk = s.session_sk);
    SET @aged_sessions = (SELECT COUNT(*) FROM @aged);
    IF @aged_sessions > 0
    BEGIN
        DELETE e FROM central.diag_events e JOIN @aged a ON a.session_sk = e.session_sk;
        SET @aged_events = @@ROWCOUNT;
        DELETE g FROM central.diag_gaps g JOIN @aged a ON a.session_sk = g.session_sk;
    END

    INSERT INTO central.maintenance_log (action, details_json)
    VALUES (N'retentionCleanup', (
        SELECT @promoted AS promotedToAbandoned, @orphan_batches AS orphanBatchesSwept,
               @aged_sessions AS agedSessions, @aged_events AS agedEventRows
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));

    SELECT @promoted AS promoted_to_abandoned, @orphan_batches AS orphan_batches_swept,
           @aged_sessions AS aged_sessions, @aged_events AS aged_event_rows;
END
GO

/* ---------------------------------------------------------------------------
   usp_store_health — one row set of store facts (H-6)
   --------------------------------------------------------------------------- */
CREATE OR ALTER PROCEDURE central.usp_store_health
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        (SELECT schema_version FROM central.schema_info WHERE schema_name = N'central') AS schema_version,
        (SELECT contract_version FROM central.schema_info WHERE schema_name = N'central') AS contract_version,
        (SELECT rank_table_version FROM central.schema_info WHERE schema_name = N'central') AS rank_table_version,
        (SELECT MAX(committed_at_utc) FROM central.upload_batches b
          WHERE b.source_kind = N'perfRun' AND b.status IN (N'committed', N'reprojected', N'extended')) AS latest_perf_run_utc,
        (SELECT MAX(committed_at_utc) FROM central.upload_batches b
          WHERE b.source_kind = N'diagSession' AND b.status IN (N'committed', N'reprojected', N'extended')) AS latest_diag_session_utc,
        (SELECT COUNT(*) FROM central.central_entities WHERE purged_at_utc IS NULL) AS live_entities,
        (SELECT COUNT(*) FROM central.upload_batches WHERE status = N'started') AS started_batches,
        (SELECT COUNT(*) FROM central.upload_batches
          WHERE status IN (N'failed', N'refused') AND started_at_utc > DATEADD(day, -7, sysutcdatetime())) AS failed_or_refused_7d,
        (SELECT COUNT(*) FROM central.diag_events) AS diag_event_rows,
        (SELECT COUNT(*) FROM central.metrics) AS metric_rows,
        (SELECT MAX(at_utc) FROM central.maintenance_log WHERE action = N'retentionCleanup') AS last_retention_cleanup_utc,
        (SELECT COUNT(*) FROM central.upload_items i
          JOIN central.upload_batches b ON b.upload_batch_id = i.upload_batch_id
          WHERE b.status = N'started' AND i.status <> N'applied') AS pending_staging_items;
END
GO
