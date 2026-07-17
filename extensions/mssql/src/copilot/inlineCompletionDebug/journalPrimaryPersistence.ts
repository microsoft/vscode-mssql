/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Journal-primary persistence orchestration (WI-2.7). This module is the
 * ONLY place the experimental `trace.journalPrimary` flag changes behavior;
 * with the flag off every function below delegates to the untouched legacy
 * path in tracePersistence.ts byte-identically (rollback posture, §10.1).
 *
 * Lives beside — not inside — tracePersistence.ts so the legacy module keeps
 * zero knowledge of the journal (and no import cycle with the binding).
 *
 * Behavior with the flag ON and the capture journal active:
 * - `saveInlineCompletionTraceNowJournalAware` / session export assemble a
 *   v2 trace from a repository snapshot (flush barrier → journal read →
 *   projection → serializeFeatureTraceV2); any doubt falls back to the
 *   legacy v1 writer so nothing is ever lost;
 * - `saveInlineCompletionTraceOnDeactivateJournalAware` SKIPS the legacy
 *   `mssql-copilot-trace-*.json` deactivate save when (and only when) the
 *   journal is a provably healthy durable record for the epoch — the
 *   decision ladder lives in journalPrimaryTrace.ts and the chosen rung is
 *   logged once.
 */

import * as vscode from "vscode";
import { writeFeatureTraceFile } from "../../diagnostics/featureCapture/traceFiles";
import { NodeJournalFs } from "../../diagnostics/featureCapture/journal/journalWriter";
import { FeatureTraceProvenance } from "../../sharedInterfaces/featureTrace";
import { logger2 } from "../../models/logger2";
import { getErrorMessage } from "../../utils/utils";
import { getCompletionsJournalBinding, getCompletionsJournalFs } from "./completionsJournalBinding";
import { inlineCompletionDebugStore } from "./inlineCompletionDebugStore";
import {
    AssembleJournalPrimaryTraceResult,
    CompletionsTraceEnvelopeV2,
    assembleJournalPrimaryV2Trace,
    resolveJournalPrimaryDeactivateDecision,
} from "./journalPrimaryTrace";
import { getRecordWhenClosedSetting } from "./services/inlineCompletionCaptureService";
import {
    SaveInlineCompletionTraceResult,
    createTraceFileName,
    getConfiguredTraceFolder,
    getTraceCaptureEnabledSetting,
    getTraceJournalPrimarySetting,
    getTraceMaxFileSizeMBSetting,
    getTraceRedactPromptsSetting,
    saveInlineCompletionTraceNow,
    saveInlineCompletionTraceOnDeactivate,
} from "./tracePersistence";

const journalPrimaryLogger = logger2.withPrefix("InlineCompletionTrace");
const CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY =
    "mssql.copilot.inlineCompletions.debug.customPromptSavedAt";

/**
 * Deactivate save with the WI-2.7 decision ladder. Flag off → delegates to
 * the untouched legacy saveInlineCompletionTraceOnDeactivate byte-
 * identically. The chosen rung is logged once.
 */
export async function saveInlineCompletionTraceOnDeactivateJournalAware(
    context: vscode.ExtensionContext,
): Promise<SaveInlineCompletionTraceResult> {
    const journalPrimaryEnabled = getTraceJournalPrimarySetting();
    if (journalPrimaryEnabled && getTraceCaptureEnabledSetting()) {
        const binding = getCompletionsJournalBinding();
        const health = binding?.health();
        const decision = resolveJournalPrimaryDeactivateDecision({
            journalPrimaryEnabled,
            bindingActive: binding?.isActive === true,
            epochStreamCount: binding?.currentEpochStreamDirectories.length ?? 0,
            ringEventCount: inlineCompletionDebugStore.getEvents().length,
            ringEvictedCount: inlineCompletionDebugStore.evictedEventCount,
            ...(health?.writer ? { writerState: health.writer.state } : {}),
            epochDroppedRecords: health?.epochDroppedRecords ?? 0,
            linklessSkipped: health?.linklessSkipped ?? 0,
        });
        if (decision.skipLegacySave) {
            journalPrimaryLogger.info(
                `journalPrimary: skipping the legacy deactivate trace file — ${decision.reason}.`,
            );
            return { skipped: "journalPrimary" };
        }
        journalPrimaryLogger.info(
            `journalPrimary: keeping the legacy deactivate trace file — ${decision.reason}.`,
        );
    }
    return saveInlineCompletionTraceOnDeactivate(context);
}

/**
 * Explicit "save trace now" with journal-primary v2 assembly. Flag off (or
 * any assembly doubt) → the untouched legacy v1 writer.
 */
export async function saveInlineCompletionTraceNowJournalAware(
    context: vscode.ExtensionContext,
    options: { skipIfEmpty?: boolean } = {},
): Promise<SaveInlineCompletionTraceResult> {
    const assembled = await tryAssembleJournalPrimaryTrace(context, {
        customPromptLastSavedAt: context.workspaceState.get<number | undefined>(
            CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY,
            undefined,
        ),
        maxFileSizeMB: getTraceMaxFileSizeMBSetting(),
    });
    if (!assembled) {
        return saveInlineCompletionTraceNow(context, options);
    }
    if (assembled.events.length === 0 && options.skipIfEmpty) {
        return { skipped: "empty" };
    }
    const folder = getConfiguredTraceFolder(context);
    try {
        const filePath = await writeFeatureTraceFile(
            folder,
            createTraceFileName(assembled.savedAt),
            assembled,
        );
        journalPrimaryLogger.info(
            `journalPrimary: saved v2 inline completion trace (journal snapshot) to ${filePath}`,
        );
        return { filePath };
    } catch (error) {
        const message = `Failed to save inline completion trace: ${getErrorMessage(error)}`;
        journalPrimaryLogger.warn(message);
        return { error: message };
    }
}

/**
 * Session-export assembly for the repository's exportSession (user-chosen
 * file). Returns undefined whenever the caller must use the legacy v1
 * export — flag off, journal inactive, or any assembly doubt (logged).
 */
export async function tryAssembleJournalPrimarySessionExport(
    context: vscode.ExtensionContext,
    customPromptLastSavedAt: number | undefined,
): Promise<CompletionsTraceEnvelopeV2 | undefined> {
    return tryAssembleJournalPrimaryTrace(context, { customPromptLastSavedAt });
}

// ---------------------------------------------------------------------------
// Shared assembly wrapper
// ---------------------------------------------------------------------------

async function tryAssembleJournalPrimaryTrace(
    context: vscode.ExtensionContext,
    options: { customPromptLastSavedAt: number | undefined; maxFileSizeMB?: number },
): Promise<CompletionsTraceEnvelopeV2 | undefined> {
    if (!getTraceJournalPrimarySetting()) {
        return undefined;
    }
    const binding = getCompletionsJournalBinding();
    if (!binding || !binding.isActive) {
        journalPrimaryLogger.info(
            "journalPrimary: capture journal inactive — using the legacy v1 trace path.",
        );
        return undefined;
    }
    const result: AssembleJournalPrimaryTraceResult = await assembleJournalPrimaryV2Trace({
        source: binding,
        fs: getCompletionsJournalFs() ?? new NodeJournalFs(),
        ringEventCount: inlineCompletionDebugStore.getEvents().length,
        ringEvictedCount: inlineCompletionDebugStore.evictedEventCount,
        overrides: inlineCompletionDebugStore.getOverrides(),
        recordWhenClosed: getRecordWhenClosedSetting(),
        extensionVersion: getExtensionVersion(context),
        customPromptLastSavedAt: options.customPromptLastSavedAt,
        redactPrompts: getTraceRedactPromptsSetting(),
        ...(options.maxFileSizeMB !== undefined ? { maxFileSizeMB: options.maxFileSizeMB } : {}),
        provenance: buildLocalProvenance(context),
    });
    if (result.kind === "fallbackLegacy") {
        journalPrimaryLogger.warn(
            `journalPrimary: falling back to the legacy v1 trace path — ${result.reason}.`,
        );
        return undefined;
    }
    const errorIssues = result.issues.filter((issue) => issue.severity === "error").length;
    if (errorIssues > 0) {
        journalPrimaryLogger.warn(
            `journalPrimary: v2 trace assembled with ${errorIssues} journal issue(s) (partial evidence is exported honestly).`,
        );
    }
    return result.envelope;
}

function buildLocalProvenance(context: vscode.ExtensionContext): FeatureTraceProvenance {
    return {
        extensionVersion: getExtensionVersion(context),
        vscodeVersion: vscode.version,
        platform: process.platform,
        origin: "localProduct",
    };
}

function getExtensionVersion(context: vscode.ExtensionContext): string {
    const packageJson = context.extension.packageJSON as { version?: unknown } | undefined;
    return typeof packageJson?.version === "string" ? packageJson.version : "unknown";
}
