/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio run capture + replay contracts (design 04 §17.2/17.3), built
 * on the generic feature-replay types. JSON-serializable, webview-safe.
 *
 * Privacy: a QsRunRecord captures SQL text DIGESTS by default (salted,
 * session-scoped). Batch/script text is present ONLY when Debug Console
 * elevated capture (mode "full" with allowSqlText) was active at record
 * time — recorded honestly in `elevated` + `capturePolicyId` (worksheet
 * row 9: effective-mode reporting). Records without text cannot be
 * replayed; the runner refuses honestly instead of guessing.
 */

import { RequestType } from "vscode-jsonrpc";
import {
    FeatureReplayMatrixCellBase,
    FeatureReplayState,
    FeatureReplayTags,
} from "./featureReplay";
import { QueryTuningOverrides, QueryTuningSnapshot } from "./queryTuning";

export const QS_RUN_RECORD_VERSION = 1;

export interface QsRunBatchDescriptor {
    ordinal: number;
    /** Salted digest of the batch text — always present. */
    textDigest: string;
    /** Batch text — ONLY under elevated capture. */
    text?: string;
    charCount: number;
}

export interface QsRunOutcome {
    status: string;
    batches: number;
    resultSets: number;
    totalRows: number;
    errors: number;
    rowsAffected?: number;
    durationMs: number;
}

export interface QsRunRecord {
    id: string;
    timestamp: number;
    /** Run status doubles as the replay-engine runnable gate ("pending" while executing). */
    result: string;
    recordVersion: typeof QS_RUN_RECORD_VERSION;
    documentUriDigest: string;
    /** Salted digest of server\database identity — never a connection string. */
    profileFingerprint?: string;
    database?: string;
    scope: "document" | "selection";
    mode: "normal" | "parseOnly" | "estimatedPlan" | "actualPlan";
    splitterVersion: string;
    catalogGeneration?: number;
    /** Full script text — ONLY under elevated capture (replay input). */
    scriptText?: string;
    scriptCharCount: number;
    batches: QsRunBatchDescriptor[];
    outcome?: QsRunOutcome;
    msToFirstResult?: number;
    elevated: boolean;
    capturePolicyId: string;
    /** Resolved QueryTuning snapshot the run executed with (QO-1). */
    tuning?: QueryTuningSnapshot;
    /** Present when this run was itself a replay. */
    replayTags?: FeatureReplayTags;
}

/** Per-row replay config: null = use the record's own value. */
export interface QsReplayConfig {
    database: string | null;
    mode: "normal" | "parseOnly" | "estimatedPlan" | "actualPlan" | null;
    stopOnError: boolean | null;
    /**
     * QueryTuning overrides the replay executes with (QO-1); null = replay
     * with the record's captured tuning snapshot when present, else current
     * resolution. Matrix cells vary this to sweep parameters.
     */
    tuning: QueryTuningOverrides | null;
}

export interface QsReplayMatrixCell extends FeatureReplayMatrixCellBase {
    database?: string;
    mode?: "normal" | "parseOnly" | "estimatedPlan" | "actualPlan";
    /** Tuning axis for parameter-sweep experiments (QO-1). */
    tuning?: QueryTuningOverrides;
    label: string;
}

export type QsReplayState = FeatureReplayState<QsRunRecord, QsReplayConfig, QsReplayMatrixCell>;

export interface QsReplayTargetInfo {
    uriKey: string;
    fileName: string;
    connected: boolean;
    matchesRecord?: boolean;
}

export interface QueryStudioReplayWebviewState {
    records: QsRunRecord[];
    captureArmed: boolean;
    elevatedCapture: boolean;
    liveTargets: QsReplayTargetInfo[];
    replay: QsReplayState;
    lastError?: string;
}

export interface QueryStudioReplayReducers {
    refresh: Record<string, never>;
    clearRecords: Record<string, never>;
    addToCart: { recordIds: string[] };
    removeFromCart: { snapshotId: string };
    clearCart: Record<string, never>;
    setCartOverride: { snapshotId: string; override: Partial<QsReplayConfig> | null };
    queueCart: { configMode?: "snapshot" | "override" | "live" };
    runMatrix: { databases: string[]; modes: Array<"normal" | "estimatedPlan" | "actualPlan"> };
    cancelRun: { runId?: string };
    saveTraceNow: Record<string, never>;
}

export namespace QsReplayListRecordsRequest {
    export const type = new RequestType<void, { records: QsRunRecord[] }, void>(
        "qsReplay/listRecords",
    );
}
