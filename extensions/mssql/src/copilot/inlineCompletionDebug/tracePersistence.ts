/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as Constants from "../../constants/constants";
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
        const serialized = JSON.stringify(trace, undefined, 2);
        fs.writeFileSync(filePath, serialized, "utf8");
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
    const configured = vscode.workspace
        .getConfiguration()
        .get<string>(Constants.configCopilotInlineCompletionsTraceFolder, "")
        .trim();
    if (configured.length === 0) {
        return vscode.Uri.joinPath(context.globalStorageUri, DEFAULT_TRACE_FOLDER_NAME).fsPath;
    }

    return expandHome(configured);
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
            .get<boolean>(Constants.configCopilotInlineCompletionsTraceRedactPrompts, false) ??
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
    const openFolder = "Open folder";
    const openOutput = "Open output";
    const selection = await vscode.window.showWarningMessage(message, openFolder, openOutput);
    if (selection === openFolder) {
        await vscode.env.openExternal(vscode.Uri.file(folder));
    } else if (selection === openOutput) {
        traceLogger.show();
    }
}
