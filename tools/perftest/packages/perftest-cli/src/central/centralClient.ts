/**
 * Central-store SQL client for the CLI writer (central design §8.1, review
 * addendum §6). Wraps the `mssql` (tedious) driver with typed, parameterized
 * calls to the central.usp_* procedures — the CLI never builds SQL literals
 * for data (that encoder exists for the product's data plane, and T-B6 pins
 * the two call styles to identical stored rows).
 *
 * Connection resolution: explicit --target argument, else the
 * MSSQL_PERFTEST_CENTRAL_CONNSTRING environment variable. The raw string is
 * never persisted, logged, or echoed (canary-scanned in CLI output tests).
 */

import * as sql from "mssql";
import type { CentralProjection, UploadDisposition, UploadReceipt } from "@mssqlperf/contracts";
import { principalDigest, type PrincipalInput } from "@mssqlperf/contracts";
import { parseSqlConnectionString } from "../sql/sqlProvisioner";

export const CENTRAL_CONNSTRING_ENV = "MSSQL_PERFTEST_CENTRAL_CONNSTRING";

export class CentralClientError extends Error {
    constructor(
        message: string,
        public readonly code:
            | "noTarget"
            | "integratedAuthUnsupported"
            | "connectFailed"
            | "protocol",
    ) {
        super(message);
        this.name = "CentralClientError";
    }
}

export interface CentralTarget {
    server: string;
    database: string;
    user?: string;
    password?: string;
    trustServerCertificate: boolean;
    encrypt: boolean;
}

/** Resolve the central target from --target or the env var. Never logged. */
export function resolveCentralTarget(explicit?: string): CentralTarget {
    const raw = explicit ?? process.env[CENTRAL_CONNSTRING_ENV];
    if (!raw) {
        throw new CentralClientError(
            `No central target: pass --target or set ${CENTRAL_CONNSTRING_ENV}`,
            "noTarget",
        );
    }
    const parsed = parseSqlConnectionString(raw);
    if (parsed.integrated || !parsed.user || !parsed.password) {
        throw new CentralClientError(
            "Central connection needs SQL authentication (User Id + Password); the Node TDS driver " +
                "cannot use Integrated Security. Create a SQL login for the central store — see " +
                "coding-docs/observability-docs/central/setup-instructions.md",
            "integratedAuthUnsupported",
        );
    }
    return {
        server: parsed.server,
        database: parsed.database ?? "PerfCentral",
        user: parsed.user,
        password: parsed.password,
        trustServerCertificate: parsed.trustServerCertificate ?? true,
        encrypt: (parsed.encrypt ?? "true").toLowerCase() !== "false",
    };
}

export interface CentralIdentity {
    tool: string;
    toolVersion: string;
    principal: PrincipalInput;
    displayName?: string;
    isCi?: boolean;
}

export class CentralClient {
    private constructor(
        private readonly pool: sql.ConnectionPool,
        readonly target: CentralTarget,
    ) {}

    static async connect(target: CentralTarget): Promise<CentralClient> {
        // ADO.NET server syntax: "host", "host,port", or "host\instance".
        let host = target.server;
        let port: number | undefined;
        let instanceName: string | undefined;
        if (host.includes(",")) {
            const [h, p] = host.split(",");
            host = h!;
            port = Number(p);
        } else if (host.includes("\\")) {
            const [h, i] = host.split("\\");
            host = h!;
            instanceName = i;
        }
        const pool = new sql.ConnectionPool({
            server: host,
            ...(port !== undefined ? { port } : {}),
            database: target.database,
            user: target.user,
            password: target.password,
            options: {
                trustServerCertificate: target.trustServerCertificate,
                encrypt: target.encrypt,
                instanceName,
                useUTC: true,
            },
            pool: { max: 4, min: 0 },
            requestTimeout: 60_000,
            connectionTimeout: 15_000,
        });
        try {
            await pool.connect();
        } catch (error) {
            throw new CentralClientError(
                `Cannot connect to central store: ${(error as Error).message}`,
                "connectFailed",
            );
        }
        return new CentralClient(pool, target);
    }

    async close(): Promise<void> {
        await this.pool.close();
    }

    /** Raw query escape hatch for admin/check flows (no user data). */
    async query<T = Record<string, unknown>>(text: string): Promise<T[]> {
        const result = await this.pool.request().query(text);
        return (result.recordset ?? []) as T[];
    }

    /** Execute one batch of an idempotent DDL script (init/migrate). */
    async batch(text: string): Promise<void> {
        await this.pool.request().batch(text);
    }

    async beginUpload(
        projection: CentralProjection,
        identity: CentralIdentity,
    ): Promise<UploadDisposition> {
        const request = this.pool.request();
        request.input("source_kind", sql.NVarChar(30), projection.kind);
        request.input("natural_key", sql.NVarChar(200), projection.naturalKey);
        request.input("source_digest", sql.NVarChar(100), projection.sourceDigest);
        request.input("content_digest", sql.NVarChar(100), projection.contentDigest);
        request.input("projection_digest", sql.NVarChar(100), projection.projectionDigest);
        request.input("preview_digest", sql.NVarChar(100), projection.previewDigest);
        request.input("contract_version", sql.NVarChar(40), projection.identity.contractVersion);
        request.input("projector_version", sql.NVarChar(80), projection.identity.projectorVersion);
        request.input("upload_policy_id", sql.NVarChar(120), projection.identity.uploadPolicyId);
        request.input("tool", sql.NVarChar(60), identity.tool);
        request.input("tool_version", sql.NVarChar(60), identity.toolVersion);
        request.input("principal_kind", sql.NVarChar(30), identity.principal.kind);
        request.input("principal_digest", sql.NVarChar(80), principalDigest(identity.principal));
        request.input("display_name", sql.NVarChar(200), identity.displayName ?? null);
        request.input("is_ci", sql.Bit, identity.isCi ? 1 : 0);
        request.input(
            "source_summary_json",
            sql.NVarChar(sql.MAX),
            JSON.stringify(projection.preview.sourceSummary),
        );
        request.input(
            "dropped_counts_json",
            sql.NVarChar(sql.MAX),
            JSON.stringify(Object.fromEntries(projection.preview.dropped.map((d) => [d.field, d]))),
        );
        request.input(
            "digested_counts_json",
            sql.NVarChar(sql.MAX),
            JSON.stringify(
                Object.fromEntries(projection.preview.digested.map((d) => [d.field, d])),
            ),
        );
        const result = await request.execute("central.usp_begin_upload");
        const row = result.recordset?.[0] as
            | {
                  disposition: string;
                  upload_batch_id: number | null;
                  reason_code: string | null;
                  applied_items_json: string;
              }
            | undefined;
        if (!row) {
            throw new CentralClientError(
                "usp_begin_upload returned no disposition row",
                "protocol",
            );
        }
        return {
            disposition: row.disposition as UploadDisposition["disposition"],
            uploadBatchId: row.upload_batch_id,
            reasonCode: row.reason_code,
            appliedItems: JSON.parse(row.applied_items_json || "[]"),
        };
    }

    async stageItem(
        uploadBatchId: number,
        item: {
            item_kind: string;
            item_ordinal: number;
            row_count: number;
            payload_digest: string;
            payload_json: string;
        },
    ): Promise<void> {
        const request = this.pool.request();
        request.input("upload_batch_id", sql.BigInt, uploadBatchId);
        request.input("item_kind", sql.NVarChar(50), item.item_kind);
        request.input("item_ordinal", sql.Int, item.item_ordinal);
        request.input("row_count", sql.Int, item.row_count);
        request.input("payload_digest", sql.NVarChar(100), item.payload_digest);
        request.input("payload", sql.NVarChar(sql.MAX), item.payload_json);
        await request.execute("central.usp_stage_upload_item");
    }

    async commitUpload(
        uploadBatchId: number,
        expectedItems: number,
        expectedRows: Record<string, number>,
    ): Promise<UploadReceipt> {
        const request = this.pool.request();
        request.input("upload_batch_id", sql.BigInt, uploadBatchId);
        request.input("expected_items", sql.Int, expectedItems);
        request.input("expected_rows_json", sql.NVarChar(sql.MAX), JSON.stringify(expectedRows));
        const result = await request.execute("central.usp_commit_upload");
        const row = result.recordset?.[0] as Record<string, unknown> | undefined;
        if (!row) {
            throw new CentralClientError("usp_commit_upload returned no receipt row", "protocol");
        }
        return receiptFromRow(row);
    }

    async abortUpload(
        uploadBatchId: number,
        finalStatus: string,
        reasonCode?: string,
    ): Promise<void> {
        const request = this.pool.request();
        request.input("upload_batch_id", sql.BigInt, uploadBatchId);
        request.input("final_status", sql.NVarChar(30), finalStatus);
        request.input("reason_code", sql.NVarChar(200), reasonCode ?? null);
        await request.execute("central.usp_abort_upload");
    }

    async storeHealth(): Promise<Record<string, unknown>> {
        const result = await this.pool.request().execute("central.usp_store_health");
        return (result.recordset?.[0] ?? {}) as Record<string, unknown>;
    }

    async retentionCleanup(options?: {
        diagEventDays?: number;
        abandonAfterDays?: number;
        orphanAfterDays?: number;
    }): Promise<Record<string, unknown>> {
        const request = this.pool.request();
        if (options?.diagEventDays !== undefined) {
            request.input("diag_event_days", sql.Int, options.diagEventDays);
        }
        if (options?.abandonAfterDays !== undefined) {
            request.input("abandon_after_days", sql.Int, options.abandonAfterDays);
        }
        if (options?.orphanAfterDays !== undefined) {
            request.input("orphan_after_days", sql.Int, options.orphanAfterDays);
        }
        const result = await request.execute("central.usp_retention_cleanup");
        return (result.recordset?.[0] ?? {}) as Record<string, unknown>;
    }

    async setBaseline(args: {
        baselineName: string;
        scenarioId?: string;
        metricName?: string;
        environmentHash?: string;
        runId: string;
        principal: PrincipalInput;
    }): Promise<void> {
        const request = this.pool.request();
        request.input("baseline_name", sql.NVarChar(120), args.baselineName);
        request.input("scenario_id", sql.NVarChar(200), args.scenarioId ?? "");
        request.input("metric_name", sql.NVarChar(200), args.metricName ?? "");
        request.input("environment_hash", sql.NVarChar(100), args.environmentHash ?? "");
        request.input("run_id", sql.NVarChar(100), args.runId);
        request.input("principal_kind", sql.NVarChar(30), args.principal.kind);
        request.input("principal_digest", sql.NVarChar(80), principalDigest(args.principal));
        await request.execute("central.usp_set_baseline");
    }

    async purgeEntity(kind: string, naturalKey: string, reason: string): Promise<void> {
        const request = this.pool.request();
        request.input("kind", sql.NVarChar(30), kind);
        request.input("natural_key", sql.NVarChar(200), naturalKey);
        request.input("reason", sql.NVarChar(200), reason);
        request.input("clear_uploader_display", sql.Bit, 0);
        await request.execute("central.usp_purge_entity");
    }
}

function receiptFromRow(row: Record<string, unknown>): UploadReceipt {
    return {
        uploadBatchId: Number(row["upload_batch_id"]),
        outcome: String(row["outcome"]) as UploadReceipt["outcome"],
        kind: String(row["source_kind"]) as UploadReceipt["kind"],
        naturalKey: String(row["natural_key"]),
        uploadPolicyId: String(row["upload_policy_id"]),
        rowsByItemKind: parseRowCounts(row["row_counts_json"]),
        sourceDigest: String(row["source_digest"]),
        contentDigest: String(row["content_digest"]),
        projectionDigest: String(row["projection_digest"]),
        previewDigest: String(row["preview_digest"]),
        committedAtUtc: row["committed_at_utc"]
            ? new Date(row["committed_at_utc"] as string).toISOString()
            : null,
    };
}

function parseRowCounts(value: unknown): Record<string, number> {
    if (typeof value !== "string" || value.length === 0) {
        return {};
    }
    try {
        const parsed = JSON.parse(value) as Array<{ item_kind: string; rows: number }>;
        return Object.fromEntries(parsed.map((p) => [p.item_kind, p.rows]));
    } catch {
        return {};
    }
}

/**
 * Upload a full projection through the ingest protocol: begin → stage
 * (skipping resume-applied items) → commit; abort on failure. This is THE
 * writer path — push and the integration tests share it.
 */
export async function uploadProjection(
    client: CentralClient,
    projection: CentralProjection,
    identity: CentralIdentity,
): Promise<{ disposition: UploadDisposition; receipt?: UploadReceipt }> {
    const disposition = await client.beginUpload(projection, identity);
    if (disposition.disposition === "alreadyPresent" || disposition.disposition === "refused") {
        return { disposition };
    }
    if (disposition.uploadBatchId === null) {
        throw new CentralClientError("proceed/resume disposition without a batch id", "protocol");
    }
    const batchId = disposition.uploadBatchId;
    const applied = new Set(
        disposition.appliedItems.map((i) => `${i.item_kind}|${i.item_ordinal}|${i.payload_digest}`),
    );
    try {
        for (const item of projection.items) {
            if (applied.has(`${item.item_kind}|${item.item_ordinal}|${item.payload_digest}`)) {
                continue;
            }
            await client.stageItem(batchId, item);
        }
        const expectedRows: Record<string, number> = {};
        for (const item of projection.items) {
            expectedRows[item.item_kind] = (expectedRows[item.item_kind] ?? 0) + item.row_count;
        }
        const receipt = await client.commitUpload(batchId, projection.items.length, expectedRows);
        return { disposition, receipt };
    } catch (error) {
        try {
            await client.abortUpload(batchId, "failed", (error as Error).name);
        } catch {
            // the batch stays 'started'; retention promotes it to abandoned later
        }
        throw error;
    }
}
