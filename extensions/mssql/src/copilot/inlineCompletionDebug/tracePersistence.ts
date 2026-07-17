/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completions trace persistence over the generic trace-file helpers (B7):
 * folder resolution, naming, and disk writes are shared; this file owns the
 * completions settings surface (trace.captureEnabled/redactPrompts/
 * maxFileSizeMB/folder, recordWhenClosed) and the save-on-deactivate policy.
 */

import * as vscode from "vscode";
import * as Constants from "../../constants/constants";
import {
    createFeatureTraceFileName,
    resolveFeatureTraceFolder,
    writeFeatureTraceFile,
} from "../../diagnostics/featureCapture/traceFiles";
import { logger2 } from "../../models/logger2";
import { getErrorMessage } from "../../utils/utils";
import { inlineCompletionDebugStore } from "./inlineCompletionDebugStore";

const traceLogger = logger2.withPrefix("InlineCompletionTrace");
export const DEFAULT_TRACE_FOLDER_NAME = "copilot-completion-traces";
export const TRACE_FILE_PREFIX = "mssql-copilot-trace-";
export const TRACE_FILE_GLOB = `${TRACE_FILE_PREFIX}*.json`;
const CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY =
    "mssql.copilot.inlineCompletions.debug.customPromptSavedAt";

export interface SaveInlineCompletionTraceResult {
    filePath?: string;
    /**
     * "journalPrimary" (WI-2.7): the deactivate save was deliberately skipped
     * because the journal-primary flag is on and the capture journal is the
     * healthy durable record for the epoch.
     */
    skipped?: "captureDisabled" | "empty" | "journalPrimary";
    error?: string;
}

export async function saveInlineCompletionTraceOnDeactivate(
    context: vscode.ExtensionContext,
): Promise<SaveInlineCompletionTraceResult> {
    if (!getTraceCaptureEnabledSetting()) {
        return { skipped: "captureDisabled" };
    }

    return saveInlineCompletionTraceNow(context, { skipIfEmpty: true });
}

export async function saveInlineCompletionTraceNow(
    context: vscode.ExtensionContext,
    options: { skipIfEmpty?: boolean } = {},
): Promise<SaveInlineCompletionTraceResult> {
    const events = inlineCompletionDebugStore.getEvents();
    if (events.length === 0 && options.skipIfEmpty) {
        return { skipped: "empty" };
    }

    const folder = getConfiguredTraceFolder(context);
    try {
        const trace = inlineCompletionDebugStore.exportSession(
            getRecordWhenClosedSetting(),
            getExtensionVersion(context),
            context.workspaceState.get<number | undefined>(
                CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY,
                undefined,
            ),
            {
                redactPrompts: getTraceRedactPromptsSetting(),
                maxFileSizeMB: getTraceMaxFileSizeMBSetting(),
            },
        );
        const filePath = await writeFeatureTraceFile(
            folder,
            createTraceFileName(trace._savedAt),
            trace,
        );
        traceLogger.info(`Saved inline completion trace to ${filePath}`);
        return { filePath };
    } catch (error) {
        const message = `Failed to save inline completion trace: ${getErrorMessage(error)}`;
        traceLogger.warn(message);
        await showTraceWriteWarning(folder, message);
        return { error: message };
    }
}

export function getConfiguredTraceFolder(context: vscode.ExtensionContext): string {
    return resolveFeatureTraceFolder(
        vscode.workspace
            .getConfiguration()
            .get<string>(Constants.configCopilotInlineCompletionsTraceFolder, ""),
        context,
        DEFAULT_TRACE_FOLDER_NAME,
    );
}

export function createTraceFileName(savedAtIso: string = new Date().toISOString()): string {
    return createFeatureTraceFileName({ filePrefix: TRACE_FILE_PREFIX }, savedAtIso);
}

export function getTraceCaptureEnabledSetting(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsTraceCaptureEnabled, false) ??
        false
    );
}

export function getTraceRedactPromptsSetting(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsTraceRedactPrompts, false) ??
        false
    );
}

/**
 * WI-2.7: the experimental journal-primary flag (observability-lab
 * workflow). Default FALSE — with it off, every persistence path below is
 * byte-identical to the pre-flag behavior (the addendum's rollback posture).
 */
export function getTraceJournalPrimarySetting(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsTraceJournalPrimary, false) ??
        false
    );
}

export function getTraceMaxFileSizeMBSetting(): number {
    const configured = vscode.workspace
        .getConfiguration()
        .get<number>(Constants.configCopilotInlineCompletionsTraceMaxFileSizeMB, 50);
    return typeof configured === "number" && Number.isFinite(configured) && configured > 0
        ? configured
        : 50;
}

function getRecordWhenClosedSetting(): boolean {
    return (
        vscode.workspace
            .getConfiguration()
            .get<boolean>(Constants.configCopilotInlineCompletionsDebugRecordWhenClosed, false) ??
        false
    );
}

function getExtensionVersion(context: vscode.ExtensionContext): string {
    const packageJson = context.extension.packageJSON as { version?: unknown } | undefined;
    return typeof packageJson?.version === "string" ? packageJson.version : "unknown";
}

async function showTraceWriteWarning(folder: string, message: string): Promise<void> {
    const openFolder = "Open folder";
    const openOutput = "Open output";
    const selection = await vscode.window.showWarningMessage(message, openFolder, openOutput);
    if (selection === openFolder) {
        await vscode.env.openExternal(vscode.Uri.file(folder));
    } else if (selection === openOutput) {
        traceLogger.show();
    }
}
