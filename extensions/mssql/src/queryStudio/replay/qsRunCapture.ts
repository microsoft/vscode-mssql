/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * QsRunRecord capture (design 04 §17.2) on the generic feature-capture
 * framework: every armed Query Studio execution records a replay descriptor
 * — SQL text DIGESTS by default; script/batch text only while Debug Console
 * elevated capture (mode "full" + allowSqlText) is active, with the
 * effective policy recorded on the record (worksheet row 9).
 *
 * Arming = Replay Lab panel open OR mssql.queryStudio.replay.enabled.
 */

import * as vscode from "vscode";
import { FeatureCaptureStore } from "../../diagnostics/featureCapture/captureStore";
import { serializeFeatureTrace } from "../../diagnostics/featureCapture/traceCodec";
import {
    createFeatureTraceFileName,
    writeFeatureTraceFile,
} from "../../diagnostics/featureCapture/traceFiles";
import { diag } from "../../diagnostics/diagnosticsCore";
import { digestValue } from "../../diagnostics/redaction";
import { logger2 } from "../../models/logger2";
import {
    QS_RUN_RECORD_VERSION,
    QsReplayConfig,
    QsRunBatchDescriptor,
    QsRunOutcome,
    QsRunRecord,
} from "../../sharedInterfaces/queryStudioReplay";
import { FeatureReplayTags } from "../../sharedInterfaces/featureReplay";
import {
    QueryTuningSnapshot,
    normalizeQueryTuningOverrides,
} from "../../sharedInterfaces/queryTuning";
import { splitBatches } from "../../sql/batchSplitter";

export const QS_REPLAY_ENABLED_SETTING = "mssql.queryStudio.replay.enabled";
export const QS_RUN_TRACE_FOLDER_NAME = "querystudio-run-traces";
export const QS_RUN_TRACE_FILE_PREFIX = "mssql-querystudio-run-";
export const QS_SPLITTER_VERSION = "lexer-v1";

const captureLogger = logger2.withPrefix("QueryStudioReplay");

const defaultReplayConfig: QsReplayConfig = {
    database: null,
    mode: null,
    stopOnError: null,
    tuning: null,
};

function normalizeTuning(value: unknown): QsReplayConfig["tuning"] {
    if (value === null || value === undefined || typeof value !== "object") {
        return null;
    }
    const normalized = normalizeQueryTuningOverrides(value);
    return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeConfig(config: Partial<QsReplayConfig>): QsReplayConfig {
    return {
        database: typeof config.database === "string" ? config.database : null,
        mode:
            config.mode === "normal" ||
            config.mode === "parseOnly" ||
            config.mode === "estimatedPlan" ||
            config.mode === "actualPlan"
                ? config.mode
                : null,
        stopOnError: typeof config.stopOnError === "boolean" ? config.stopOnError : null,
        tuning: normalizeTuning(config.tuning),
    };
}

function normalizePartialConfig(config: Partial<QsReplayConfig>): Partial<QsReplayConfig> {
    const normalized: Partial<QsReplayConfig> = {};
    if (Object.prototype.hasOwnProperty.call(config, "database")) {
        normalized.database = typeof config.database === "string" ? config.database : null;
    }
    if (Object.prototype.hasOwnProperty.call(config, "mode")) {
        normalized.mode =
            config.mode === "normal" ||
            config.mode === "parseOnly" ||
            config.mode === "estimatedPlan" ||
            config.mode === "actualPlan"
                ? config.mode
                : null;
    }
    if (Object.prototype.hasOwnProperty.call(config, "stopOnError")) {
        normalized.stopOnError =
            typeof config.stopOnError === "boolean" ? config.stopOnError : null;
    }
    if (Object.prototype.hasOwnProperty.call(config, "tuning")) {
        normalized.tuning = normalizeTuning(config.tuning);
    }
    return normalized;
}

export const qsRunCaptureStore = new FeatureCaptureStore<QsRunRecord, QsReplayConfig>({
    logName: "QueryStudioRunCapture",
    featureId: "queryStudio",
    idPrefix: "R",
    defaultOverrides: defaultReplayConfig,
    normalizeOverrides: normalizeConfig,
    normalizePartialOverrides: normalizePartialConfig,
});

export function isQsReplayCaptureSettingEnabled(): boolean {
    return (
        vscode.workspace.getConfiguration().get<boolean>(QS_REPLAY_ENABLED_SETTING, false) ?? false
    );
}

export function shouldCaptureQsRuns(): boolean {
    return qsRunCaptureStore.shouldCapture(isQsReplayCaptureSettingEnabled());
}

export function isElevatedCaptureActive(): boolean {
    const policy = diag.capturePolicy;
    return policy.mode === "full" && policy.allowSqlText === true;
}

export interface BeginRunRecordInput {
    text: string;
    uriKey: string;
    scope: "document" | "selection";
    mode: "normal" | "parseOnly" | "estimatedPlan" | "actualPlan";
    server?: string;
    database?: string;
    catalogGeneration?: number;
    /** Resolved QueryTuning snapshot the run executes with (QO-1). */
    tuning?: QueryTuningSnapshot;
    replayTags?: FeatureReplayTags;
}

/**
 * Record the start of an armed run. Returns the record id (finalized by
 * completeRunRecord) or undefined when capture is not armed.
 */
export function beginRunRecord(input: BeginRunRecordInput): string | undefined {
    if (!shouldCaptureQsRuns()) {
        return undefined;
    }

    const elevated = isElevatedCaptureActive();
    // Durable identity reserved before the record or any Plane-A reverse link
    // (emission-ordering rule, final plan WI-0.3).
    const link = qsRunCaptureStore.createEventLink({ editorSurface: "queryStudio" });
    const batches: QsRunBatchDescriptor[] = splitBatches(input.text).map((batch, index) => ({
        ordinal: index,
        textDigest: digestValue("sql", batch.text),
        ...(elevated ? { text: batch.text } : {}),
        charCount: batch.text.length,
    }));
    const record = qsRunCaptureStore.addEvent({
        timestamp: Date.now(),
        link,
        result: "pending",
        recordVersion: QS_RUN_RECORD_VERSION,
        documentUriDigest: digestValue("uri", input.uriKey),
        ...(input.server || input.database
            ? {
                  profileFingerprint: digestValue(
                      "profile",
                      `${input.server ?? ""}\\${input.database ?? ""}`,
                  ),
              }
            : {}),
        ...(input.database ? { database: input.database } : {}),
        scope: input.scope,
        mode: input.mode,
        splitterVersion: QS_SPLITTER_VERSION,
        ...(input.catalogGeneration !== undefined
            ? { catalogGeneration: input.catalogGeneration }
            : {}),
        ...(elevated ? { scriptText: input.text } : {}),
        scriptCharCount: input.text.length,
        batches,
        elevated,
        capturePolicyId: diag.capturePolicy.policyId,
        ...(input.tuning ? { tuning: input.tuning } : {}),
        ...(input.replayTags ? { replayTags: input.replayTags } : {}),
    });

    diag.emit({
        feature: "queryStudio",
        kind: "event",
        type: "queryStudio.runRecord.captured",
        fields: {
            batches: { raw: batches.length, cls: "diagnostic.metadata" },
            elevated: { raw: elevated, cls: "diagnostic.metadata" },
            replay: { raw: input.replayTags !== undefined, cls: "diagnostic.metadata" },
            captureFeatureId: { raw: link.featureId, cls: "diagnostic.metadata" },
            captureSessionId: { raw: link.captureSessionId, cls: "diagnostic.metadata" },
            captureEventId: { raw: link.captureEventId, cls: "diagnostic.metadata" },
        },
    });
    return record.id;
}

export function completeRunRecord(
    recordId: string | undefined,
    outcome: QsRunOutcome,
    msToFirstResult?: number,
): void {
    if (!recordId) {
        return;
    }

    qsRunCaptureStore.mutateEvent(recordId, (record) => {
        record.result = outcome.status;
        record.outcome = { ...outcome };
        if (msToFirstResult !== undefined) {
            record.msToFirstResult = msToFirstResult;
        }
        return true;
    });
}

export interface SaveQsRunTraceResult {
    filePath?: string;
    skipped?: "empty";
    error?: string;
}

/** Persist the current run records under globalStorage (explicit action). */
export async function saveQsRunTraceNow(
    context: vscode.ExtensionContext,
): Promise<SaveQsRunTraceResult> {
    const events = qsRunCaptureStore.getEvents();
    if (events.length === 0) {
        return { skipped: "empty" };
    }

    const folder = vscode.Uri.joinPath(context.globalStorageUri, QS_RUN_TRACE_FOLDER_NAME).fsPath;
    try {
        const trace = serializeFeatureTrace(events, {
            extensionVersion: getExtensionVersion(context),
            overrides: qsRunCaptureStore.getOverrides(),
            recordWhenClosed: isQsReplayCaptureSettingEnabled(),
        });
        const filePath = await writeFeatureTraceFile(
            folder,
            createFeatureTraceFileName({ filePrefix: QS_RUN_TRACE_FILE_PREFIX }, trace._savedAt),
            trace,
        );
        captureLogger.info(`Saved Query Studio run trace to ${filePath}`);
        return { filePath };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        captureLogger.warn(`Failed to save Query Studio run trace: ${message}`);
        return { error: message };
    }
}

function getExtensionVersion(context: vscode.ExtensionContext): string {
    const packageJson = context.extension.packageJSON as { version?: unknown } | undefined;
    return typeof packageJson?.version === "string" ? packageJson.version : "unknown";
}
