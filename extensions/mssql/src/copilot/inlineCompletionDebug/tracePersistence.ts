/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as Constants from "../../constants/constants";
import * as LocalizedConstants from "../../constants/locConstants";
import { logger } from "../../models/logger";
import { getErrorMessage } from "../../utils/utils";
import { inlineCompletionDebugStore } from "./inlineCompletionDebugStore";
import { MAX_TRACE_FILE_SIZE_MB, serializeTraceFile } from "./traceSerializer";

const traceLogger = logger.withPrefix("InlineCompletionTrace");
export const DEFAULT_TRACE_MAX_FILE_SIZE_MB = 50;
export const DEFAULT_TRACE_FOLDER_NAME = "copilot-completion-traces";
export const TRACE_FILE_PREFIX = "mssql-copilot-trace-";
export const TRACE_FILE_GLOB = `${TRACE_FILE_PREFIX}*.json`;
const CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY =
    "mssql.copilot.inlineCompletions.debug.customPromptSavedAt";

export interface SaveInlineCompletionTraceResult {
    filePath?: string;
    skipped?: "captureDisabled" | "empty";
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
        await fs.promises.mkdir(folder, { recursive: true });
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
        const filePath = path.join(folder, createTraceFileName(trace._savedAt));
        const serialized = serializeTraceFile(trace);
        await fs.promises.writeFile(filePath, serialized, "utf8");
        traceLogger.info(`Saved inline completion trace to ${filePath}`);
        return { filePath };
    } catch (error) {
        const message = LocalizedConstants.inlineCompletionTraceSaveFailed(getErrorMessage(error));
        traceLogger.warn(message);
        await showTraceWriteWarning(folder, message);
        return { error: message };
    }
}

export function getConfiguredTraceFolder(context: vscode.ExtensionContext): string {
    const configured = vscode.workspace
        .getConfiguration()
        .get<string>(Constants.configCopilotInlineCompletionsTraceFolder, "")
        .trim();
    if (configured.length === 0) {
        return vscode.Uri.joinPath(context.globalStorageUri, DEFAULT_TRACE_FOLDER_NAME).fsPath;
    }

    const expanded = expandHome(configured);
    if (!path.isAbsolute(expanded)) {
        traceLogger.warn(
            `Ignoring relative inline completion trace folder '${configured}'; using extension storage instead.`,
        );
        return vscode.Uri.joinPath(context.globalStorageUri, DEFAULT_TRACE_FOLDER_NAME).fsPath;
    }

    return expanded;
}

export function createTraceFileName(savedAtIso: string = new Date().toISOString()): string {
    return `${TRACE_FILE_PREFIX}${savedAtIso.replace(/:/g, "-").replace(".", "-")}.json`;
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
            .get<boolean>(Constants.configCopilotInlineCompletionsTraceRedactPrompts, true) ?? true
    );
}

export function getTraceMaxFileSizeMBSetting(): number {
    const configured = vscode.workspace
        .getConfiguration()
        .get<number>(
            Constants.configCopilotInlineCompletionsTraceMaxFileSizeMB,
            DEFAULT_TRACE_MAX_FILE_SIZE_MB,
        );
    if (typeof configured !== "number" || !Number.isFinite(configured) || configured <= 0) {
        return DEFAULT_TRACE_MAX_FILE_SIZE_MB;
    }

    if (configured > MAX_TRACE_FILE_SIZE_MB) {
        traceLogger.warn(
            `Clamping inline completion trace size ${configured} MB to the ${MAX_TRACE_FILE_SIZE_MB} MB limit that trace loading enforces.`,
        );
        return MAX_TRACE_FILE_SIZE_MB;
    }

    return configured;
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

function expandHome(folder: string): string {
    if (folder === "~") {
        return os.homedir();
    }

    if (folder.startsWith("~/") || folder.startsWith("~\\")) {
        return path.join(os.homedir(), folder.slice(2));
    }

    return folder;
}

async function showTraceWriteWarning(folder: string, message: string): Promise<void> {
    const openFolder = LocalizedConstants.inlineCompletionTraceOpenFolder;
    const openOutput = LocalizedConstants.inlineCompletionTraceOpenOutput;
    const selection = await vscode.window.showWarningMessage(message, openFolder, openOutput);
    if (selection === openFolder) {
        await vscode.env.openExternal(vscode.Uri.file(folder));
    } else if (selection === openOutput) {
        traceLogger.show();
    }
}
