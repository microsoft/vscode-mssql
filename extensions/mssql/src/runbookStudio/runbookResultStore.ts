/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Typed output store (ADR-5): runtime boundary payloads become opaque
 * handles; the webview pulls bounded pages through the controller. Accepted
 * payloads are byte-capped with HONEST truncation marking, spilled to disk
 * (write-through at put time), and lazily rehydrated on a fetch miss after
 * restart — a run's results survive the window that produced them. An
 * evicted or unrecoverable handle renders as "detail data expired", never
 * as an empty result (rendering-spec honesty rule).
 *
 * Layout: <resultsDir>/<runId>/index.json     (handleId -> file map, versioned)
 *         <resultsDir>/<runId>/h_<n>.json     (one bounded payload each)
 */

import * as fs from "fs";
import * as path from "path";
import { TransformPipeline } from "../sharedInterfaces/runbookPresentation";
import { DataHandleRef } from "../sharedInterfaces/runbookStudio";
import { sanitizeRunFileId } from "./runbookRunLedger";
import {
    applyTransformPipeline,
    PresentationTable,
    PresentationTransformFailureReason,
} from "./presentation/presentationTransforms";
import type { RuntimeOutputPayload } from "./runtime/runtimeAdapterTypes";
import {
    isOutputArtifactContract,
    retainedOutputArtifact,
    RetainedOutputArtifact,
} from "./outputArtifact";

interface StoredOutput {
    payload: RuntimeOutputPayload;
    bytes: number;
    truncated?: boolean;
}

export const RESULT_INDEX_SCHEMA_VERSION = 1;

interface ResultIndexEntry {
    handleId: string;
    /** File name inside the run directory holding the payload wrapper. */
    file: string;
    contract: string;
    rows?: number;
    bytes: number;
    truncated?: boolean;
}

interface ResultIndexFile {
    schemaVersion: number;
    runId: string;
    entries: ResultIndexEntry[];
}

interface ResultPayloadFile {
    schemaVersion: number;
    handleId: string;
    truncated?: boolean;
    payload: RuntimeOutputPayload;
}

const MAX_BYTES_PER_RUN = 32 * 1024 * 1024;
const MAX_PAGE_ROWS = 1000;
/** Per-payload retention cap; larger payloads keep a bounded prefix and are
 *  marked truncated (rows are additionally row-capped by the producing lane). */
const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;

export interface RunbookResultStoreOptions {
    /** Injectable for tests; production uses the 1MB default. */
    maxPayloadBytes?: number;
    /** Persistence problems surface here (the store stays diag-free). */
    onPersistenceIssue?: (kind: string, detail: string) => void;
}

export interface StoredOutputPage {
    columns?: string[];
    rows?: Array<Array<string | number | boolean | null>>;
    totalRows?: number;
    truncated?: boolean;
    transformError?: never;
}

export interface StoredOutputTransformFailure {
    transformError: PresentationTransformFailureReason;
    columns?: never;
    rows?: never;
    totalRows?: never;
    truncated?: never;
}

export class RunbookResultStore {
    private readonly outputs = new Map<string, StoredOutput>();
    private readonly runBytes = new Map<string, number>();
    private handleCounter = 0;
    private readonly maxPayloadBytes: number;
    private readonly onPersistenceIssue: (kind: string, detail: string) => void;

    constructor(
        /** Absent = memory-only (test hosts); results then do not survive restart. */
        private readonly resultsDir?: string,
        options?: RunbookResultStoreOptions,
    ) {
        this.maxPayloadBytes = options?.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
        this.onPersistenceIssue = options?.onPersistenceIssue ?? (() => undefined);
    }

    /** Store one boundary payload; returns the handle ref for the ledger.
     *  The ref (and the ledger event that carries it) is the durable name;
     *  the payload spills to disk write-through so a later session can
     *  serve it again. */
    public put(runId: string, nodeId: string, payload: RuntimeOutputPayload): DataHandleRef {
        this.handleCounter++;
        const handleId = `${runId}/${nodeId}/${this.handleCounter.toString(36)}`;
        const bounded = boundPayload(payload, this.maxPayloadBytes);
        if (!bounded) {
            // Cannot be bounded under the cap (no rows/text to trim): the
            // handle exists but its detail is not retained.
            return {
                handleId,
                contract: payload.contract,
                ...(payload.rows ? { rows: payload.rows.length } : {}),
                bytes: approximateBytes(payload),
                expired: true,
            };
        }
        const used = this.runBytes.get(runId) ?? 0;
        if (used + bounded.bytes > MAX_BYTES_PER_RUN) {
            // Over the per-run quota: the handle exists but its detail is
            // not retained (and never spills).
            return {
                handleId,
                contract: payload.contract,
                ...(payload.rows ? { rows: payload.rows.length } : {}),
                bytes: bounded.bytes,
                expired: true,
            };
        }
        const stored: StoredOutput = {
            payload: bounded.payload,
            bytes: bounded.bytes,
            ...(bounded.truncated ? { truncated: true } : {}),
        };
        this.outputs.set(handleId, stored);
        this.runBytes.set(runId, used + bounded.bytes);
        this.spill(runId, handleId, stored);
        return {
            handleId,
            contract: payload.contract,
            ...(bounded.payload.rows ? { rows: bounded.payload.rows.length } : {}),
            bytes: bounded.bytes,
            ...(bounded.truncated ? { truncated: true } : {}),
        };
    }

    public fetchPage(
        handleId: string,
        startRow: number,
        rowCount: number,
    ): StoredOutputPage | undefined {
        const stored = this.outputs.get(handleId) ?? this.rehydrate(handleId);
        if (!stored) {
            return undefined;
        }
        const payload = stored.payload;
        const truncatedMark = stored.truncated ? { truncated: true } : {};
        if (payload.rows) {
            const start = Math.max(0, startRow);
            const count = Math.min(Math.max(0, rowCount), MAX_PAGE_ROWS);
            return {
                ...(payload.columns ? { columns: payload.columns } : {}),
                rows: payload.rows.slice(start, start + count),
                totalRows: payload.rows.length,
                ...truncatedMark,
            };
        }
        if (payload.text !== undefined) {
            return { columns: ["text"], rows: [[payload.text]], totalRows: 1, ...truncatedMark };
        }
        if (payload.scalars) {
            const entries = outputScalarEntries(payload);
            return {
                columns: ["name", "value"],
                rows: entries.map(([k, v]) => [k, v]),
                totalRows: entries.length,
                ...truncatedMark,
            };
        }
        return { rows: [], totalRows: 0, ...truncatedMark };
    }

    /** Apply a validated, pure presentation pipeline to the retained bounded
     * payload, then page the result. The transformed table is intentionally
     * ephemeral: the durable ledger continues to name the original runtime
     * evidence and a presentation edit cannot mutate it. */
    public fetchTransformedPage(
        handleId: string,
        pipeline: TransformPipeline,
        startRow: number,
        rowCount: number,
    ): StoredOutputPage | StoredOutputTransformFailure | undefined {
        const stored = this.outputs.get(handleId) ?? this.rehydrate(handleId);
        if (!stored) {
            return undefined;
        }
        const input = tableForStoredOutput(stored);
        const transformed = applyTransformPipeline(input, pipeline);
        if ("reason" in transformed) {
            return { transformError: transformed.reason };
        }
        const start = Math.max(0, startRow);
        const count = Math.min(Math.max(0, rowCount), MAX_PAGE_ROWS);
        return {
            columns: transformed.table.columns,
            rows: transformed.table.rows.slice(start, start + count),
            totalRows: transformed.table.rows.length,
            ...(transformed.table.truncated ? { truncated: true } : {}),
        };
    }

    /** Trusted-host read for an exact text contract. Unlike fetchPage this
     * never crosses the controller boundary and never coerces rows/scalars
     * into text. Callers must refuse truncated content before exporting it. */
    public readTextPayload(
        handleId: string,
        expectedContract: string,
    ): { text: string; truncated: boolean } | undefined {
        const stored = this.outputs.get(handleId) ?? this.rehydrate(handleId);
        if (
            !stored ||
            stored.payload.contract !== expectedContract ||
            typeof stored.payload.text !== "string"
        ) {
            return undefined;
        }
        return { text: stored.payload.text, truncated: stored.truncated === true };
    }

    /** Host-only typed artifact metadata. The path never crosses the
     * controller boundary; the service must still confine and hash-verify it
     * immediately before any native file action. */
    public readOutputArtifact(handleId: string): RetainedOutputArtifact | undefined {
        const stored = this.outputs.get(handleId) ?? this.rehydrate(handleId);
        return stored ? retainedOutputArtifact(stored.payload) : undefined;
    }

    /** Drop a run's payloads from memory AND disk (retention GC / delete). */
    public deleteRunResults(runId: string): void {
        for (const handleId of [...this.outputs.keys()]) {
            if (handleId.startsWith(`${runId}/`)) {
                this.outputs.delete(handleId);
            }
        }
        this.runBytes.delete(runId);
        if (!this.resultsDir) {
            return;
        }
        try {
            fs.rmSync(this.runDir(runId), { recursive: true, force: true });
        } catch (error) {
            this.onPersistenceIssue("deleteFailed", describeError(error));
        }
    }

    /** Persisted run directories (sanitized run ids) — GC orphan sweep. */
    public listPersistedRunIds(): string[] {
        if (!this.resultsDir) {
            return [];
        }
        try {
            return fs
                .readdirSync(this.resultsDir, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name);
        } catch {
            return [];
        }
    }

    // -- persistence internals ----------------------------------------------

    private runDir(runId: string): string {
        // resultsDir is always set on paths that call this.
        return path.join(this.resultsDir!, sanitizeRunFileId(runId));
    }

    /** Write-through spill: payload file first, then the index (tmp+rename
     *  so a crash never leaves a torn index). Failures are reported and the
     *  in-memory copy stays valid — this session still renders. */
    private spill(runId: string, handleId: string, stored: StoredOutput): void {
        if (!this.resultsDir) {
            return;
        }
        try {
            const dir = this.runDir(runId);
            fs.mkdirSync(dir, { recursive: true });
            const file = `h_${this.handleCounter.toString(36)}.json`;
            const wrapper: ResultPayloadFile = {
                schemaVersion: RESULT_INDEX_SCHEMA_VERSION,
                handleId,
                ...(stored.truncated ? { truncated: true } : {}),
                payload: stored.payload,
            };
            fs.writeFileSync(path.join(dir, file), JSON.stringify(wrapper));
            const index = this.readIndex(runId) ?? {
                schemaVersion: RESULT_INDEX_SCHEMA_VERSION,
                runId,
                entries: [],
            };
            index.entries = index.entries.filter((e) => e.handleId !== handleId);
            index.entries.push({
                handleId,
                file,
                contract: stored.payload.contract,
                ...(stored.payload.rows ? { rows: stored.payload.rows.length } : {}),
                bytes: stored.bytes,
                ...(stored.truncated ? { truncated: true } : {}),
            });
            const indexPath = path.join(dir, "index.json");
            const tempPath = indexPath + ".tmp";
            fs.writeFileSync(tempPath, JSON.stringify(index));
            fs.renameSync(tempPath, indexPath);
        } catch (error) {
            this.onPersistenceIssue("spillFailed", describeError(error));
        }
    }

    /** Lazy rehydration on a fetch miss: resolve the handle through the
     *  run's index, load ONLY that payload, and cache it. Any mismatch or
     *  unreadable file resolves to undefined — expired, never invented. */
    private rehydrate(handleId: string): StoredOutput | undefined {
        if (!this.resultsDir) {
            return undefined;
        }
        const runId = handleId.split("/")[0];
        if (!runId || runId === handleId) {
            return undefined;
        }
        const index = this.readIndex(runId);
        const entry = index?.entries.find((e) => e.handleId === handleId);
        if (!entry) {
            return undefined;
        }
        try {
            const wrapper = JSON.parse(
                fs.readFileSync(path.join(this.runDir(runId), entry.file), "utf8"),
            ) as ResultPayloadFile;
            if (
                wrapper.schemaVersion !== RESULT_INDEX_SCHEMA_VERSION ||
                wrapper.handleId !== handleId ||
                typeof wrapper.payload?.contract !== "string"
            ) {
                return undefined;
            }
            const stored: StoredOutput = {
                payload: wrapper.payload,
                bytes: entry.bytes,
                ...(wrapper.truncated ? { truncated: true } : {}),
            };
            this.outputs.set(handleId, stored);
            this.runBytes.set(runId, (this.runBytes.get(runId) ?? 0) + entry.bytes);
            return stored;
        } catch (error) {
            this.onPersistenceIssue("rehydrateFailed", describeError(error));
            return undefined;
        }
    }

    private readIndex(runId: string): ResultIndexFile | undefined {
        try {
            const index = JSON.parse(
                fs.readFileSync(path.join(this.runDir(runId), "index.json"), "utf8"),
            ) as ResultIndexFile;
            if (
                index.schemaVersion !== RESULT_INDEX_SCHEMA_VERSION ||
                !Array.isArray(index.entries)
            ) {
                return undefined;
            }
            return index;
        } catch {
            return undefined;
        }
    }
}

function tableForStoredOutput(stored: StoredOutput): PresentationTable {
    const payload = stored.payload;
    if (payload.rows) {
        const inferredWidth = payload.rows.reduce((width, row) => Math.max(width, row.length), 0);
        return {
            columns:
                payload.columns && payload.columns.length >= inferredWidth
                    ? [...payload.columns]
                    : Array.from({ length: inferredWidth }, (_, index) => `column${index + 1}`),
            rows: payload.rows.map((row) => [...row]),
            ...(stored.truncated ? { truncated: true } : {}),
        };
    }
    if (payload.scalars) {
        return {
            columns: ["name", "value"],
            rows: outputScalarEntries(payload),
            ...(stored.truncated ? { truncated: true } : {}),
        };
    }
    if (payload.text !== undefined) {
        return {
            columns: ["text"],
            rows: [[payload.text]],
            ...(stored.truncated ? { truncated: true } : {}),
        };
    }
    return { columns: [], rows: [], ...(stored.truncated ? { truncated: true } : {}) };
}

/** File-system locators stay host-only even when the rest of an artifact's
 * scalar evidence (digest, size, time, database) renders in Results. */
function outputScalarEntries(
    payload: RuntimeOutputPayload,
): Array<[string, string | number | boolean]> {
    return Object.entries(payload.scalars ?? {}).filter(
        ([key]) => !(isOutputArtifactContract(payload.contract) && key === "artifactPath"),
    );
}

/**
 * Enforce the per-payload byte cap with honest truncation: rows keep a
 * bounded prefix, text keeps a bounded prefix, and anything that still
 * cannot fit refuses retention (undefined -> expired handle). Pure.
 */
export function boundPayload(
    payload: RuntimeOutputPayload,
    maxBytes: number,
): { payload: RuntimeOutputPayload; bytes: number; truncated?: boolean } | undefined {
    let bytes = approximateBytes(payload);
    if (bytes <= maxBytes) {
        return { payload, bytes };
    }
    if (payload.rows && payload.rows.length > 0) {
        let keep = Math.max(1, Math.floor((payload.rows.length * maxBytes) / bytes));
        for (;;) {
            const candidate = { ...payload, rows: payload.rows.slice(0, keep) };
            bytes = approximateBytes(candidate);
            if (bytes <= maxBytes) {
                return { payload: candidate, bytes, truncated: true };
            }
            if (keep === 0) {
                break;
            }
            keep = Math.floor(keep / 2);
        }
        return undefined;
    }
    if (payload.text !== undefined && payload.text.length > 0) {
        let keep = payload.text.length;
        while (keep > 0) {
            keep = Math.floor(keep / 2);
            const candidate = { ...payload, text: payload.text.slice(0, keep) };
            bytes = approximateBytes(candidate);
            if (bytes <= maxBytes) {
                return { payload: candidate, bytes, truncated: true };
            }
        }
        return undefined;
    }
    return undefined;
}

function approximateBytes(payload: RuntimeOutputPayload): number {
    try {
        return Buffer.byteLength(JSON.stringify(payload), "utf8");
    } catch {
        return 0;
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
