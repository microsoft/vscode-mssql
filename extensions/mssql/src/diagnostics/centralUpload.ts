/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Central-store upload over the SQL Data Plane (central design §8.3, review
 * addendum C-11). The product writer for "Upload to shared server":
 *
 *   - projection/preview come from the VENDORED contract (one implementation,
 *     two writers — sharedInterfaces/centralContract);
 *   - transport is text-only `ISqlSession.execute` — every proc call is an
 *     EXEC statement whose data rides as sqlNString literals (no parameter
 *     binding exists on the data plane); per-execute options are always
 *     { priority: "background", commandKind: "centralUpload", tag,
 *       expectedDatabase } — the metadata-engine discipline;
 *   - memory stays bounded: segments feed items, items are ≤ maxItemBytes of
 *     batch text, and cancellation lands at item boundaries only (a later
 *     upload resumes idempotently through the begin disposition).
 *
 * Privacy invariants: the projection is policy-filtered before anything
 * reaches this file; diagnostics emitted here carry counts, durations, policy
 * ids, outcomes and digest PREFIXES only — never names, endpoints, payload
 * content, or connection details.
 */

import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";

import {
    assertUploadable,
    CENTRAL_CONTRACT_VERSION,
    type CentralProjection,
    type CentralSourceKind,
    type DiagSessionSource,
    type JournalLine,
    type PerfRunSource,
    principalDigest,
    projectDiagSession,
    projectPerfRun,
    type SessionManifestShape,
    type SourceFileInfo,
    sqlNString,
    type UploadDisposition,
    type UploadItemPayload,
    type UploadPolicyId,
    type UploadReceipt,
} from "../sharedInterfaces/centralContract";
import type {
    ExecuteOptions,
    IQueryEventSink,
    ISqlConnectionService,
    ISqlSession,
    OpenSessionParams,
    QueryCompleteSummary,
    ResultSetMetadata,
    RowsPage,
} from "../services/sqlDataPlane/api";
import { diag } from "./diagnosticsCore";

export const CENTRAL_UPLOAD_APPLICATION_NAME = "vscode-mssql-central-upload";

export class CentralUploadError extends Error {
    constructor(
        message: string,
        public readonly code:
            | "notConfigured"
            | "sessionOpenFailed"
            | "protocol"
            | "refused"
            | "canceled"
            | "executeFailed",
    ) {
        super(message);
        this.name = "CentralUploadError";
    }
}

// ---------------------------------------------------------------------------
// Session-directory → DiagSessionSource loader (product half of the parity
// pair with perftest's runLoader; reads the SessionStore layout: manifest.json
// + events/*.jsonl segments).
// ---------------------------------------------------------------------------

export async function loadDiagSessionSource(sessionDir: string): Promise<DiagSessionSource> {
    const manifestPath = path.join(sessionDir, "manifest.json");
    const manifestRaw = await fs.readFile(manifestPath);
    const manifest = JSON.parse(manifestRaw.toString("utf8")) as SessionManifestShape;
    const files: SourceFileInfo[] = [
        {
            relativePath: "manifest.json",
            sha256: createHash("sha256").update(manifestRaw).digest("hex"),
            sizeBytes: manifestRaw.byteLength,
        },
    ];
    const segments: DiagSessionSource["segments"] = [];
    for (const segment of manifest.segments) {
        const segmentPath = path.join(sessionDir, "events", segment.file);
        const raw = await fs.readFile(segmentPath);
        files.push({
            relativePath: `events/${segment.file}`,
            sha256: createHash("sha256").update(raw).digest("hex"),
            sizeBytes: raw.byteLength,
        });
        const lines: JournalLine[] = [];
        for (const line of raw.toString("utf8").split("\n")) {
            const trimmed = line.trim();
            if (trimmed.length === 0) {
                continue;
            }
            try {
                lines.push(JSON.parse(trimmed) as JournalLine);
            } catch {
                // Partial trailing line (crash mid-write): the store already
                // tolerates it; the projection warns via the count mismatch.
            }
        }
        segments.push({ file: segment.file, lines });
    }
    return { manifest, segments, files };
}

// ---------------------------------------------------------------------------
// Result-row collection over the event sink
// ---------------------------------------------------------------------------

class RowCollectingSink implements IQueryEventSink {
    columns: string[] = [];
    rows: unknown[][] = [];
    errors: string[] = [];

    onResultSetStarted(meta: ResultSetMetadata): void {
        // Procs return a single result set; later sets would be a protocol bug
        // and are simply appended for visibility.
        if (this.columns.length === 0) {
            this.columns = meta.columns.map((c) => c.name);
        }
    }
    onRowsPage(page: RowsPage): void {
        for (const row of page.compact.values) {
            this.rows.push(row);
        }
    }
    onMessage(msg: { kind: string; text: string }): void {
        if (msg.kind === "error") {
            this.errors.push(msg.text);
        }
    }
    onComplete(_summary: QueryCompleteSummary): void {
        // completion is awaited via the QueryHandle promise
    }

    firstRow(): Record<string, unknown> | undefined {
        const row = this.rows[0];
        if (!row) {
            return undefined;
        }
        const out: Record<string, unknown> = {};
        this.columns.forEach((name, i) => {
            out[name] = row[i];
        });
        return out;
    }
}

// ---------------------------------------------------------------------------
// Upload service
// ---------------------------------------------------------------------------

export interface CentralUploadTargetConfig {
    /** Prepared connection facts (profileAuthAdapter.prepareConnection). */
    profileRef: OpenSessionParams["profile"];
    auth?: OpenSessionParams["auth"];
    /** Database holding the central schema (from the profile; required). */
    database: string;
}

export interface CentralUploadOptions {
    uploadPolicyId: UploadPolicyId;
    /** Encoder budget per execute; addendum C-11 default 1.5 MB. */
    maxItemBytes?: number;
    /** Alias identity for the uploaders ledger (e.g. os user@host). */
    principalAlias: string;
    displayName?: string;
    toolVersion: string;
    onProgress?(done: number, total: number): void;
    isCanceled?(): boolean;
}

export interface CentralUploadResult {
    disposition: UploadDisposition;
    receipt?: UploadReceipt;
}

export function projectSource(
    kind: CentralSourceKind,
    source: DiagSessionSource | PerfRunSource,
    uploadPolicyId: UploadPolicyId,
): CentralProjection {
    if (kind === "perfRun") {
        return projectPerfRun(source as PerfRunSource, { uploadPolicyId });
    }
    return projectDiagSession(source as DiagSessionSource, { uploadPolicyId });
}

export class CentralUploadService {
    constructor(
        private readonly connections: ISqlConnectionService,
        private readonly target: CentralUploadTargetConfig,
    ) {}

    /** Upload a projection through begin→stage→commit; abort on failure. */
    public async upload(
        projection: CentralProjection,
        options: CentralUploadOptions,
    ): Promise<CentralUploadResult> {
        assertUploadable(projection);
        const startedAt = Date.now();
        const session = await this.openSession();
        let batchId: number | null = null;
        try {
            const disposition = await this.beginUpload(session, projection, options);
            if (
                disposition.disposition === "alreadyPresent" ||
                disposition.disposition === "refused"
            ) {
                this.emitUploadEnd(projection, disposition.disposition, 0, startedAt);
                return { disposition };
            }
            batchId = disposition.uploadBatchId;
            if (batchId === null) {
                throw new CentralUploadError(
                    "begin returned proceed/resume without a batch id",
                    "protocol",
                );
            }
            const applied = new Set(
                disposition.appliedItems.map(
                    (i) => `${i.item_kind}|${i.item_ordinal}|${i.payload_digest}`,
                ),
            );
            let done = 0;
            for (const item of projection.items) {
                if (options.isCanceled?.()) {
                    throw new CentralUploadError("upload canceled", "canceled");
                }
                if (!applied.has(`${item.item_kind}|${item.item_ordinal}|${item.payload_digest}`)) {
                    await this.stageItem(session, batchId, item, options);
                }
                done++;
                options.onProgress?.(done, projection.items.length);
            }
            const receipt = await this.commitUpload(session, batchId, projection);
            this.emitUploadEnd(projection, receipt.outcome, projection.items.length, startedAt);
            return { disposition, receipt };
        } catch (error) {
            if (batchId !== null) {
                const canceled = error instanceof CentralUploadError && error.code === "canceled";
                // Canceled uploads stay 'started' so a later attempt resumes;
                // real failures are ledgered.
                if (!canceled) {
                    await this.tryAbort(session, batchId, "failed", (error as Error).name);
                }
            }
            diag.emit({
                feature: "centralObservability",
                kind: "event",
                type: "centralObservability.upload.failed",
                status: "error",
                fields: {
                    errorClass: { raw: (error as Error).name, cls: "diagnostic.metadata" },
                    outcome: {
                        raw:
                            error instanceof CentralUploadError && error.code === "canceled"
                                ? "canceled"
                                : "failed",
                        cls: "diagnostic.metadata",
                    },
                },
            });
            throw error;
        } finally {
            await session.close().catch(() => undefined);
        }
    }

    private async openSession(): Promise<ISqlSession> {
        try {
            return await this.connections.openSession({
                profile: this.target.profileRef,
                database: this.target.database,
                applicationName: CENTRAL_UPLOAD_APPLICATION_NAME,
                ...(this.target.auth ? { auth: this.target.auth } : {}),
            });
        } catch (error) {
            throw new CentralUploadError(
                `cannot open central upload session: ${(error as Error).message}`,
                "sessionOpenFailed",
            );
        }
    }

    private executeOptions(tag: string, timeoutMs: number): ExecuteOptions {
        return {
            priority: "background",
            commandKind: "centralUpload",
            tag,
            timeoutMs,
            expectedDatabase: this.target.database,
        };
    }

    private async execRows(
        session: ISqlSession,
        text: string,
        tag: string,
        timeoutMs: number,
    ): Promise<RowCollectingSink> {
        const sink = new RowCollectingSink();
        const handle = session.execute(text, this.executeOptions(tag, timeoutMs), sink);
        const summary = await handle.completion;
        if (summary.status !== "succeeded") {
            const reason = sink.errors[0] ?? summary.error?.message ?? summary.status;
            throw new CentralUploadError(`central call failed: ${reason}`, "executeFailed");
        }
        return sink;
    }

    private async beginUpload(
        session: ISqlSession,
        projection: CentralProjection,
        options: CentralUploadOptions,
    ): Promise<UploadDisposition> {
        const digest = principalDigest({ kind: "alias", value: options.principalAlias });
        const text =
            `EXEC central.usp_begin_upload ` +
            `@source_kind = ${sqlNString(projection.kind)}, ` +
            `@natural_key = ${sqlNString(projection.naturalKey)}, ` +
            `@source_digest = ${sqlNString(projection.sourceDigest)}, ` +
            `@content_digest = ${sqlNString(projection.contentDigest)}, ` +
            `@projection_digest = ${sqlNString(projection.projectionDigest)}, ` +
            `@preview_digest = ${sqlNString(projection.previewDigest)}, ` +
            `@contract_version = ${sqlNString(projection.identity.contractVersion)}, ` +
            `@projector_version = ${sqlNString(projection.identity.projectorVersion)}, ` +
            `@upload_policy_id = ${sqlNString(projection.identity.uploadPolicyId)}, ` +
            `@tool = N'debug-console', ` +
            `@tool_version = ${sqlNString(options.toolVersion)}, ` +
            `@principal_kind = N'alias', ` +
            `@principal_digest = ${sqlNString(digest)}, ` +
            `@display_name = ${options.displayName ? sqlNString(options.displayName) : "NULL"}, ` +
            `@is_ci = 0, ` +
            `@source_summary_json = ${sqlNString(JSON.stringify(projection.preview.sourceSummary))}, ` +
            `@dropped_counts_json = ${sqlNString(JSON.stringify(Object.fromEntries(projection.preview.dropped.map((d) => [d.field, d]))))}, ` +
            `@digested_counts_json = ${sqlNString(JSON.stringify(Object.fromEntries(projection.preview.digested.map((d) => [d.field, d]))))};`;
        const sink = await this.execRows(session, text, "centralUpload.begin", 30_000);
        const row = sink.firstRow();
        if (!row || typeof row["disposition"] !== "string") {
            throw new CentralUploadError("usp_begin_upload returned no disposition", "protocol");
        }
        const appliedRaw = row["applied_items_json"];
        return {
            disposition: row["disposition"] as UploadDisposition["disposition"],
            uploadBatchId: row["upload_batch_id"] === null ? null : Number(row["upload_batch_id"]),
            reasonCode: (row["reason_code"] as string | null) ?? null,
            appliedItems:
                typeof appliedRaw === "string" && appliedRaw.length > 0
                    ? (JSON.parse(appliedRaw) as UploadDisposition["appliedItems"])
                    : [],
        };
    }

    private async stageItem(
        session: ISqlSession,
        batchId: number,
        item: UploadItemPayload,
        options: CentralUploadOptions,
    ): Promise<void> {
        const text =
            `EXEC central.usp_stage_upload_item ` +
            `@upload_batch_id = ${batchId}, ` +
            `@item_kind = ${sqlNString(item.item_kind)}, ` +
            `@item_ordinal = ${item.item_ordinal}, ` +
            `@row_count = ${item.row_count}, ` +
            `@payload_digest = ${sqlNString(item.payload_digest)}, ` +
            `@payload = ${sqlNString(item.payload_json, options.maxItemBytes)};`;
        await this.execRows(session, text, `centralUpload.item.${item.item_kind}`, 60_000);
    }

    private async commitUpload(
        session: ISqlSession,
        batchId: number,
        projection: CentralProjection,
    ): Promise<UploadReceipt> {
        const expectedRows: Record<string, number> = {};
        for (const item of projection.items) {
            expectedRows[item.item_kind] = (expectedRows[item.item_kind] ?? 0) + item.row_count;
        }
        const text =
            `EXEC central.usp_commit_upload ` +
            `@upload_batch_id = ${batchId}, ` +
            `@expected_items = ${projection.items.length}, ` +
            `@expected_rows_json = ${sqlNString(JSON.stringify(expectedRows))};`;
        const sink = await this.execRows(session, text, "centralUpload.commit", 60_000);
        const row = sink.firstRow();
        if (!row || typeof row["outcome"] !== "string") {
            throw new CentralUploadError("usp_commit_upload returned no receipt", "protocol");
        }
        const rowCountsRaw = row["row_counts_json"];
        let rowsByItemKind: Record<string, number> = {};
        if (typeof rowCountsRaw === "string" && rowCountsRaw.length > 0) {
            try {
                const parsed = JSON.parse(rowCountsRaw) as Array<{
                    item_kind: string;
                    rows: number;
                }>;
                rowsByItemKind = Object.fromEntries(parsed.map((p) => [p.item_kind, p.rows]));
            } catch {
                rowsByItemKind = {};
            }
        }
        return {
            uploadBatchId: Number(row["upload_batch_id"]),
            outcome: row["outcome"] as UploadReceipt["outcome"],
            kind: projection.kind,
            naturalKey: projection.naturalKey,
            uploadPolicyId: projection.identity.uploadPolicyId,
            rowsByItemKind,
            sourceDigest: projection.sourceDigest,
            contentDigest: projection.contentDigest,
            projectionDigest: projection.projectionDigest,
            previewDigest: projection.previewDigest,
            committedAtUtc: row["committed_at_utc"] ? String(row["committed_at_utc"]) : null,
        };
    }

    private async tryAbort(
        session: ISqlSession,
        batchId: number,
        finalStatus: string,
        reasonCode: string,
    ): Promise<void> {
        try {
            await this.execRows(
                session,
                `EXEC central.usp_abort_upload @upload_batch_id = ${batchId}, ` +
                    `@final_status = ${sqlNString(finalStatus)}, ` +
                    `@reason_code = ${sqlNString(reasonCode)};`,
                "centralUpload.abort",
                30_000,
            );
        } catch {
            // batch stays 'started'; server-side retention promotes it later
        }
    }

    private emitUploadEnd(
        projection: CentralProjection,
        outcome: string,
        items: number,
        startedAt: number,
    ): void {
        diag.emit({
            feature: "centralObservability",
            kind: "span",
            type: "centralObservability.upload",
            durationMs: Date.now() - startedAt,
            fields: {
                sourceKind: { raw: projection.kind, cls: "diagnostic.metadata" },
                policyId: {
                    raw: projection.identity.uploadPolicyId,
                    cls: "diagnostic.metadata",
                },
                batchOutcome: { raw: outcome, cls: "diagnostic.metadata" },
                items: { raw: items, cls: "diagnostic.metadata" },
                rows: {
                    raw: projection.items.reduce((sum, i) => sum + i.row_count, 0),
                    cls: "diagnostic.metadata",
                },
                projectionDigestPrefix: {
                    raw: projection.projectionDigest.slice(0, 8),
                    cls: "diagnostic.metadata",
                },
                contractVersion: { raw: CENTRAL_CONTRACT_VERSION, cls: "diagnostic.metadata" },
            },
        });
    }
}
