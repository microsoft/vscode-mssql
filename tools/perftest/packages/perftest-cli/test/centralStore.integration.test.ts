/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Central-store integration tests (review addendum §10): the disposition
 * algebra (T-B1), the begin-lock race (T-B2), resume (T-B3), parity of the
 * official_metric_samples view with local SQLite (T-B7), purge (T-B13),
 * orphan sweep (T-B14), corrupt payloads (T-B16), the baseline role gate
 * (T-B17), and count-mismatch commit refusal (T-B18) — all against a REAL
 * SQL Server database.
 *
 * Gated on MSSQL_PERFTEST_CENTRAL_TEST_CONNSTRING (admin/db_owner login on a
 * dedicated test DB, e.g. PerfCentralTest). Optionally
 * MSSQL_PERFTEST_CENTRAL_TEST_WRITER_CONNSTRING (central_writer-only login)
 * enables the negative role-gate test. See setup-instructions.md.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    type CentralProjection,
    type DiagSessionSource,
    type PerfRunSource,
    projectDiagSession,
    projectPerfRun,
} from "@mssqlperf/contracts";
import {
    CentralClient,
    type CentralIdentity,
    resolveCentralTarget,
    uploadProjection,
} from "../src/central/centralClient";
import { centralCheck, centralInit } from "../src/central/centralAdmin";
import { createRootLogger } from "../src/telemetry/logger";
import { PerfStore } from "../src/store/sqliteStore";

const CONN = process.env["MSSQL_PERFTEST_CENTRAL_TEST_CONNSTRING"];
const WRITER_CONN = process.env["MSSQL_PERFTEST_CENTRAL_TEST_WRITER_CONNSTRING"];
const suite = CONN ? describe : describe.skip;

const FIXTURES = join(__dirname, "..", "..", "perf-contracts", "fixtures", "central");

function goldenRun(): PerfRunSource {
    return JSON.parse(readFileSync(join(FIXTURES, "golden-run", "source.json"), "utf8"));
}
function goldenSession(sessionId?: string): DiagSessionSource {
    const source = JSON.parse(
        readFileSync(join(FIXTURES, "golden-session", "source.json"), "utf8"),
    ) as DiagSessionSource;
    if (sessionId) {
        source.manifest.sessionId = sessionId;
    }
    return source;
}

const IDENTITY: CentralIdentity = {
    tool: "integration-test",
    toolVersion: "0.0.0",
    principal: { kind: "alias", value: "central-itest" },
};

suite("central store integration (live SQL Server)", () => {
    let client: CentralClient;
    const { logger } = createRootLogger();

    beforeAll(async () => {
        client = await CentralClient.connect(resolveCentralTarget(CONN));
        await centralInit(client, logger.child("centralItest"));
        // Reset all data (FK order) so reruns are deterministic.
        await client.batch(`
      DELETE FROM central.diag_events; DELETE FROM central.diag_gaps;
      DELETE FROM central.diag_sessions; DELETE FROM central.baselines;
      DELETE FROM central.metrics; DELETE FROM central.validations;
      DELETE FROM central.artifact_refs; DELETE FROM central.repetitions;
      DELETE FROM central.scenarios; DELETE FROM central.environments;
      DELETE FROM central.run_repositories; DELETE FROM central.runs;
      DELETE FROM central.central_entities; DELETE FROM central.upload_items;
      DELETE FROM central.upload_batches; DELETE FROM central.maintenance_log;
      DELETE FROM central.uploaders;`);
    }, 120_000);

    afterAll(async () => {
        await client?.close();
    });

    it("init is idempotent and check is green", async () => {
        await centralInit(client, logger.child("centralItest"));
        const result = await centralCheck(client);
        expect(result.issues).toEqual([]);
        expect(result.ok).toBe(true);
    }, 60_000);

    it("T-B1: commits the golden run and makes exactly the official samples visible", async () => {
        const projection = projectPerfRun(goldenRun(), { uploadPolicyId: "team-default.v1" });
        const { receipt } = await uploadProjection(client, projection, IDENTITY);
        expect(receipt?.outcome).toBe("committed");
        expect(receipt?.rowsByItemKind["metrics"]).toBe(4);
        const samples = await client.query(
            "SELECT run_id, scenario_id, rep_id, name, value FROM central.official_metric_samples ORDER BY scenario_id, rep_id",
        );
        // official + measurement + passed rep: wallclock rep0 attempt0 and rep1 attempt1
        expect(samples).toHaveLength(2);
        expect(samples.every((s) => s["name"] === "scenario.wallclock")).toBe(true);
    }, 60_000);

    it("T-B1: duplicate upload is alreadyPresent with a ledger row and no new rows", async () => {
        const projection = projectPerfRun(goldenRun(), { uploadPolicyId: "team-default.v1" });
        const { disposition, receipt } = await uploadProjection(client, projection, IDENTITY);
        expect(disposition.disposition).toBe("alreadyPresent");
        expect(receipt).toBeUndefined();
        const ledger = await client.query<{ status: string; n: number }>(
            "SELECT status, COUNT(*) AS n FROM central.upload_batches WHERE natural_key = '2026-07-01T10-00-00Z_deadbeef' GROUP BY status",
        );
        expect(ledger.find((l) => l.status === "alreadyPresent")?.n).toBe(1);
        const runs = await client.query<{ n: number }>("SELECT COUNT(*) AS n FROM central.runs");
        expect(runs[0]!.n).toBe(1);
    }, 60_000);

    it("T-B1: same source under a different policy reprojects and flips visibility", async () => {
        const projection = projectPerfRun(goldenRun(), { uploadPolicyId: "team-names.v1" });
        const { receipt } = await uploadProjection(client, projection, IDENTITY);
        expect(receipt?.outcome).toBe("reprojected");
        // Visible run now carries the kept notes (team-names), through the new batch only.
        const visible = await client.query<{ notes: string | null; n: number }>(
            `SELECT r.notes, COUNT(*) OVER () AS n
       FROM central.runs r JOIN central.central_entities e ON e.current_batch_id = r.upload_batch_id`,
        );
        expect(visible).toHaveLength(1);
        expect(visible[0]!.notes).toBe("golden run user note");
        const samples = await client.query("SELECT run_id FROM central.official_metric_samples");
        expect(samples).toHaveLength(2);
    }, 60_000);

    it("T-B1: same source+projector+policy with different rows is refused as projectionMismatch", async () => {
        const projection = projectPerfRun(goldenRun(), { uploadPolicyId: "team-names.v1" });
        const doctored: CentralProjection = {
            ...projection,
            projectionDigest: "prj_DOCTORED0000000000000",
        };
        const disposition = await client.beginUpload(doctored, IDENTITY);
        expect(disposition.disposition).toBe("refused");
        expect(disposition.reasonCode).toBe("projectionMismatch");
    }, 60_000);

    it("T-B1: a mutated source under the same key is refused as sourceMutation", async () => {
        const projection = projectPerfRun(goldenRun(), { uploadPolicyId: "team-names.v1" });
        const doctored: CentralProjection = {
            ...projection,
            sourceDigest: "src_MUTATED0000000000000000",
            contentDigest: "cnt_MUTATED0000000000000000",
            projectionDigest: "prj_MUTATED0000000000000000",
        };
        const disposition = await client.beginUpload(doctored, IDENTITY);
        expect(disposition.disposition).toBe("refused");
        expect(disposition.reasonCode).toBe("sourceMutation");
        const entity = await client.query<{ projection_digest: string }>(
            "SELECT projection_digest FROM central.central_entities WHERE natural_key = '2026-07-01T10-00-00Z_deadbeef'",
        );
        expect(entity[0]!.projection_digest).toBe(projection.projectionDigest);
    }, 60_000);

    it("T-B3: a canceled upload resumes idempotently and commits exact counts", async () => {
        const projection = projectDiagSession(goldenSession(), {
            uploadPolicyId: "team-default.v1",
        });
        const first = await client.beginUpload(projection, IDENTITY);
        expect(first.disposition).toBe("proceed");
        // Stage only the first two items, then "crash".
        await client.stageItem(first.uploadBatchId!, projection.items[0]!);
        await client.stageItem(first.uploadBatchId!, projection.items[1]!);

        const { disposition, receipt } = await uploadProjection(client, projection, IDENTITY);
        expect(disposition.disposition).toBe("resume");
        expect(disposition.uploadBatchId).toBe(first.uploadBatchId);
        expect(disposition.appliedItems).toHaveLength(2);
        expect(receipt?.outcome).toBe("committed");
        const events = await client.query<{ n: number }>(
            `SELECT COUNT(*) AS n FROM central.diag_events e
       JOIN central.diag_sessions s ON s.session_sk = e.session_sk
       JOIN central.central_entities x ON x.current_batch_id = s.upload_batch_id`,
        );
        expect(events[0]!.n).toBe(6);
    }, 60_000);

    it("T-B18: commit refuses doctored row accounting and the entity stays unchanged", async () => {
        const projection = projectDiagSession(goldenSession("sess-tb18"), {
            uploadPolicyId: "team-default.v1",
        });
        const begin = await client.beginUpload(projection, IDENTITY);
        for (const item of projection.items) {
            await client.stageItem(begin.uploadBatchId!, item);
        }
        await expect(
            client.commitUpload(begin.uploadBatchId!, projection.items.length, {
                diag_sessions: 99,
            }),
        ).rejects.toThrow(/row accounting mismatch/);
        const batch = await client.query<{ status: string }>(
            `SELECT status FROM central.upload_batches WHERE upload_batch_id = ${begin.uploadBatchId}`,
        );
        expect(batch[0]!.status).toBe("started");
        await client.abortUpload(begin.uploadBatchId!, "abandoned", "test cleanup");
    }, 60_000);

    it("T-B16: corrupt and miscounted payloads fail loudly without corrupting the batch", async () => {
        const projection = projectDiagSession(goldenSession("sess-tb16"), {
            uploadPolicyId: "team-default.v1",
        });
        const begin = await client.beginUpload(projection, IDENTITY);
        const sessionItem = projection.items[0]!;
        await expect(
            client.stageItem(begin.uploadBatchId!, { ...sessionItem, payload_json: "not json {" }),
        ).rejects.toThrow(/not valid JSON/);
        // Declared row_count mismatch → rolled back, ledgered as failed, retryable.
        await expect(
            client.stageItem(begin.uploadBatchId!, { ...sessionItem, row_count: 5 }),
        ).rejects.toThrow(/row count/);
        const failed = await client.query<{ status: string }>(
            `SELECT status FROM central.upload_items WHERE upload_batch_id = ${begin.uploadBatchId}`,
        );
        expect(failed.map((f) => f.status)).toEqual(["failed"]);
        // The retry supersedes the failed slot.
        await client.stageItem(begin.uploadBatchId!, sessionItem);
        const after = await client.query<{ status: string }>(
            `SELECT status FROM central.upload_items WHERE upload_batch_id = ${begin.uploadBatchId}`,
        );
        expect(after.map((f) => f.status)).toEqual(["applied"]);
        await client.abortUpload(begin.uploadBatchId!, "abandoned", "test cleanup");
    }, 60_000);

    it("T-B17: baselines upsert with '' wildcards; the writer role cannot set them", async () => {
        await client.setBaseline({
            baselineName: "itest-baseline",
            runId: "2026-07-01T10-00-00Z_deadbeef",
            principal: { kind: "ci", pipelineIdentity: "itest", poolName: "local" },
        });
        await client.setBaseline({
            baselineName: "itest-baseline",
            runId: "2026-07-01T10-00-00Z_deadbeef",
            principal: { kind: "ci", pipelineIdentity: "itest", poolName: "local" },
        });
        const rows = await client.query<{ scenario_id: string; n: number }>(
            "SELECT scenario_id, COUNT(*) OVER () AS n FROM central.baselines WHERE baseline_name = 'itest-baseline'",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.scenario_id).toBe(""); // NULL↔'' wildcard mapping (C-10)

        if (WRITER_CONN) {
            const writer = await CentralClient.connect(resolveCentralTarget(WRITER_CONN));
            try {
                await expect(
                    writer.setBaseline({
                        baselineName: "itest-baseline-2",
                        runId: "2026-07-01T10-00-00Z_deadbeef",
                        principal: { kind: "alias", value: "writer" },
                    }),
                ).rejects.toThrow(/permission|denied|central_ci/i);
            } finally {
                await writer.close();
            }
        }
    }, 60_000);

    it("T-B14: retention sweeps orphaned reprojection rows and promotes stale started batches", async () => {
        const before = await client.query<{ n: number }>("SELECT COUNT(*) AS n FROM central.runs");
        expect(before[0]!.n).toBeGreaterThan(1); // superseded team-default batch rows still on disk
        const result = await client.retentionCleanup({ abandonAfterDays: 0, orphanAfterDays: 0 });
        expect(Number(result["orphan_batches_swept"])).toBeGreaterThanOrEqual(1);
        const after = await client.query<{ n: number }>("SELECT COUNT(*) AS n FROM central.runs");
        expect(after[0]!.n).toBe(1); // only the current batch's run row remains
        const health = await client.storeHealth();
        expect(health["schema_version"]).toBe("central-store/1");
    }, 60_000);

    it("T-B13: purge removes kind rows, keeps safe audit, and allows re-upload", async () => {
        const projection = projectDiagSession(goldenSession("sess-purge-1"), {
            uploadPolicyId: "team-default.v1",
        });
        const { receipt } = await uploadProjection(client, projection, IDENTITY);
        expect(receipt?.outcome).toBe("committed");
        await client.purgeEntity("diagSession", "sess-purge-1", "privacy request (test)");
        const rows = await client.query<{ n: number }>(
            "SELECT COUNT(*) AS n FROM central.diag_sessions WHERE session_id = 'sess-purge-1'",
        );
        expect(rows[0]!.n).toBe(0);
        const entity = await client.query<{ purged_at_utc: unknown }>(
            "SELECT purged_at_utc FROM central.central_entities WHERE natural_key = 'sess-purge-1'",
        );
        expect(entity[0]!.purged_at_utc).not.toBeNull();
        const again = await uploadProjection(client, projection, IDENTITY);
        expect(again.receipt?.outcome).toBe("committed");
    }, 60_000);

    it("T-B2: two concurrent writers of the same key yield one commit and zero duplicates", async () => {
        const projection = projectDiagSession(goldenSession("sess-race-1"), {
            uploadPolicyId: "team-default.v1",
        });
        const other: CentralIdentity = {
            tool: "integration-test-b",
            toolVersion: "0.0.0",
            principal: { kind: "alias", value: "central-itest-2" },
        };
        const second = await CentralClient.connect(resolveCentralTarget(CONN));
        try {
            const [a, b] = await Promise.allSettled([
                uploadProjection(client, projection, IDENTITY),
                uploadProjection(second, projection, other),
            ]);
            const outcomes = [a, b].map((r) =>
                r.status === "fulfilled"
                    ? (r.value.receipt?.outcome ?? r.value.disposition.disposition)
                    : "rejected",
            );
            expect(outcomes).toContain("committed");
            expect(outcomes.filter((o) => o === "committed")).toHaveLength(1);
            expect(outcomes).not.toContain("rejected");
            const visible = await client.query<{ n: number }>(
                `SELECT COUNT(*) AS n FROM central.diag_sessions s
         JOIN central.central_entities e ON e.current_batch_id = s.upload_batch_id
         WHERE s.session_id = 'sess-race-1'`,
            );
            expect(visible[0]!.n).toBe(1);
        } finally {
            await second.close();
        }
    }, 60_000);

    it("T-B7: central official_metric_samples matches the local SQLite view on the fixture", async () => {
        const source = goldenRun();
        const dir = mkdtempSync(join(tmpdir(), "central-parity-"));
        const store = PerfStore.open(join(dir, "parity.db"), logger.child("parity"));
        try {
            store.insertRun({
                runId: source.runId,
                createdAtUnixNs: source.createdAtUnixNs,
                passType: source.passType as never,
                status: source.status as never,
                configHash: source.configHash,
                outputDir: "unused",
                environmentHash: source.environmentHash,
            });
            store.upsertEnvironment({
                environmentHash: source.environmentHash,
                capturedAtUnixNs: source.createdAtUnixNs,
                configFingerprintJson: "{}",
            });
            for (const scenario of source.scenarios) {
                store.upsertScenario({
                    scenarioId: scenario.scenarioId,
                    displayName: scenario.displayName,
                });
            }
            for (const rep of source.reps) {
                store.insertRepetition({
                    runId: source.runId,
                    scenarioId: rep.scenarioId,
                    repId: rep.repId,
                    attemptId: rep.attemptId,
                    status: rep.result.status as never,
                    warmup: rep.warmup ?? false,
                    resultPath: `${rep.repDir}/result.json`,
                });
                store.insertMetrics(
                    source.runId,
                    rep.scenarioId,
                    rep.repId,
                    rep.attemptId,
                    rep.result.metrics as never,
                );
            }
            const localRows = store
                .query<Record<string, unknown>>(
                    `SELECT run_id, scenario_id, rep_id, name, value, unit, component, process_role,
                  lower_is_better, tags_json
           FROM official_metric_samples ORDER BY scenario_id, rep_id, name`,
                )
                .map(normalizeSampleRow);
            const centralRows = (
                await client.query(
                    `SELECT run_id, scenario_id, rep_id, name, value, unit, component, process_role,
                  lower_is_better, tags_json
           FROM central.official_metric_samples ORDER BY scenario_id, rep_id, name`,
                )
            ).map(normalizeSampleRow);
            expect(centralRows).toEqual(localRows);
            expect(centralRows.length).toBeGreaterThan(0);
        } finally {
            store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);
});

function normalizeSampleRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
        ...row,
        lower_is_better: Number(row["lower_is_better"] ?? 0),
        tags_json: row["tags_json"] ? JSON.parse(String(row["tags_json"])) : null,
    };
}

suite("T-B6: literal-encoder call style matches parameterized calls", () => {
    it("stores byte-identical diag_event rows through both writer call shapes", async () => {
        const client = await CentralClient.connect(resolveCentralTarget(CONN));
        const { sqlNString } = await import("@mssqlperf/contracts");
        try {
            const paramSession = goldenSession("sess-tb6-param");
            const litSession = goldenSession("sess-tb6-lit");
            const paramProjection = projectDiagSession(paramSession, {
                uploadPolicyId: "team-default.v1",
            });
            const litProjection = projectDiagSession(litSession, {
                uploadPolicyId: "team-default.v1",
            });

            await uploadProjection(client, paramProjection, IDENTITY);

            // Literal style: exactly what the product data plane will send (C-11).
            const begin = await client.beginUpload(litProjection, IDENTITY);
            expect(begin.disposition).toBe("proceed");
            for (const item of litProjection.items) {
                await client.batch(
                    `EXEC central.usp_stage_upload_item ` +
                        `@upload_batch_id = ${begin.uploadBatchId}, ` +
                        `@item_kind = ${sqlNString(item.item_kind)}, ` +
                        `@item_ordinal = ${item.item_ordinal}, ` +
                        `@row_count = ${item.row_count}, ` +
                        `@payload_digest = ${sqlNString(item.payload_digest)}, ` +
                        `@payload = ${sqlNString(item.payload_json, 16 * 1024 * 1024)};`,
                );
            }
            const expectedRows: Record<string, number> = {};
            for (const item of litProjection.items) {
                expectedRows[item.item_kind] = (expectedRows[item.item_kind] ?? 0) + item.row_count;
            }
            const receipt = await client.commitUpload(
                begin.uploadBatchId!,
                litProjection.items.length,
                expectedRows,
            );
            expect(receipt.outcome).toBe("committed");

            const rowsFor = async (sessionId: string) =>
                client.query(
                    `SELECT e.seq, e.event_id, e.epoch_ms, e.monotonic_ns, e.process, e.pid, e.feature,
                  e.kind, e.type, e.status, e.trace_id, e.cause_event_id, e.entity_kind,
                  e.entity_ref, e.duration_ms, e.timing_class, e.cls_max, e.cls_rank,
                  e.cls_redacted_fields, e.tags_json, e.payload_json, e.payload_digest
           FROM central.diag_events e
           JOIN central.diag_sessions s ON s.session_sk = e.session_sk
           WHERE s.session_id = '${sessionId}' ORDER BY e.seq`,
                );
            const paramRows = await rowsFor("sess-tb6-param");
            const litRows = await rowsFor("sess-tb6-lit");
            expect(litRows).toHaveLength(6);
            expect(litRows).toEqual(paramRows);
        } finally {
            await client.close();
        }
    }, 60_000);
});
