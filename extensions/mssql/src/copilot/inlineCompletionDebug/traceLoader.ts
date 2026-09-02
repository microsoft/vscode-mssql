/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugExportData,
    InlineCompletionDebugTraceIndexEntry,
} from "../../sharedInterfaces/inlineCompletionDebug";
import { getErrorMessage } from "../../utils/utils";
import { TRACE_FILE_GLOB, TRACE_FILE_PREFIX } from "./tracePersistence";
import { MAX_TRACE_FILE_BYTES } from "./traceSerializer";

export const MAX_TRACE_LOAD_BYTES = MAX_TRACE_FILE_BYTES;

export function createTraceFolderWatcher(
    folder: string,
    onDidChange: () => void,
): vscode.FileSystemWatcher {
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(folder), TRACE_FILE_GLOB),
    );
    watcher.onDidCreate(onDidChange);
    watcher.onDidChange(onDidChange);
    watcher.onDidDelete(onDidChange);
    return watcher;
}

export async function scanTraceFolder(
    folder: string,
    includedFileKeys: ReadonlySet<string> = new Set(),
    loadedFileKeys: ReadonlySet<string> = new Set(),
): Promise<InlineCompletionDebugTraceIndexEntry[]> {
    let dirents: fs.Dirent[];
    try {
        dirents = await fs.promises.readdir(folder, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw error;
    }

    const entries = await Promise.all(
        dirents
            .filter((dirent) => dirent.isFile())
            .filter((dirent) => isTraceFileName(dirent.name))
            .map(async (dirent) => {
                const filePath = path.join(folder, dirent.name);
                return indexTraceFile(filePath, {
                    included: includedFileKeys.size === 0 || includedFileKeys.has(filePath),
                    loaded: loadedFileKeys.has(filePath),
                    imported: false,
                });
            }),
    );

    return entries.sort((left, right) => (right.savedAt ?? "").localeCompare(left.savedAt ?? ""));
}

export async function indexTraceFile(
    filePath: string,
    options: { included: boolean; loaded: boolean; imported: boolean },
): Promise<InlineCompletionDebugTraceIndexEntry> {
    const filename = path.basename(filePath);
    const stat = await fs.promises.stat(filePath);
    try {
        const trace = await loadTraceFile(filePath);
        return createTraceIndexEntry(filePath, trace, stat.size, options);
    } catch (error) {
        return {
            fileKey: filePath,
            filename,
            path: filePath,
            eventCount: 0,
            fileSizeBytes: stat.size,
            included: options.included,
            loaded: false,
            imported: options.imported,
            loadError: getErrorMessage(error),
        };
    }
}

export async function loadTraceFile(
    filePath: string,
    maxBytes: number = MAX_TRACE_LOAD_BYTES,
): Promise<InlineCompletionDebugExportData> {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > maxBytes) {
        throw new Error(
            `${filePath} is too large to load (${stat.size} bytes; maximum ${maxBytes} bytes).`,
        );
    }
    const contents = await fs.promises.readFile(filePath, "utf8");
    return normalizeTraceFile(JSON.parse(contents), filePath);
}

export function normalizeTraceFile(
    value: unknown,
    source: string,
): InlineCompletionDebugExportData {
    if (!isRecord(value) || !Array.isArray(value.events)) {
        throw new Error(`${source} is not an inline completion trace JSON file.`);
    }
    if (value.version !== 1) {
        throw new Error(
            `${source} uses unsupported inline completion trace version '${value.version}'.`,
        );
    }
    if (!value.events.every(isInlineCompletionDebugEvent)) {
        throw new Error(`${source} contains an invalid inline completion trace event.`);
    }

    return {
        version: 1,
        exportedAt: typeof value.exportedAt === "number" ? value.exportedAt : Date.now(),
        _savedAt:
            typeof value._savedAt === "string"
                ? value._savedAt
                : new Date(
                      typeof value.exportedAt === "number" ? value.exportedAt : Date.now(),
                  ).toISOString(),
        _extensionVersion:
            typeof value._extensionVersion === "string" ? value._extensionVersion : "unknown",
        _truncated: value._truncated === true ? true : undefined,
        overrides: isRecord(value.overrides) ? (value.overrides as never) : ({} as never),
        recordWhenClosed:
            typeof value.recordWhenClosed === "boolean" ? value.recordWhenClosed : false,
        customPromptLastSavedAt:
            typeof value.customPromptLastSavedAt === "number"
                ? value.customPromptLastSavedAt
                : undefined,
        events: value.events,
    };
}

export function createTraceIndexEntry(
    filePath: string,
    trace: InlineCompletionDebugExportData,
    fileSizeBytes: number,
    options: { included: boolean; loaded: boolean; imported: boolean },
): InlineCompletionDebugTraceIndexEntry {
    const timestamps = trace.events
        .map((event) => event.timestamp)
        .filter((timestamp) => Number.isFinite(timestamp));
    const firstEvent = trace.events[0];
    return {
        fileKey: filePath,
        filename: path.basename(filePath),
        path: filePath,
        savedAt: trace._savedAt,
        sessionId: path.basename(filePath, ".json"),
        eventCount: trace.events.length,
        dateRange:
            timestamps.length > 0
                ? {
                      start: Math.min(...timestamps),
                      end: Math.max(...timestamps),
                  }
                : undefined,
        fileSizeBytes,
        profile: inferProfile(trace),
        schemaMode: inferSchemaMode(firstEvent),
        schemaSizeKind: inferSchemaSizeKind(firstEvent),
        included: options.included,
        loaded: options.loaded,
        imported: options.imported,
    };
}

function isTraceFileName(filename: string): boolean {
    return filename.startsWith(TRACE_FILE_PREFIX) && filename.endsWith(".json");
}

function inferProfile(trace: InlineCompletionDebugExportData): string | undefined {
    return (
        trace.overrides.profileId ??
        trace.events.find((event) => event.overridesApplied.profileId)?.overridesApplied
            .profileId ??
        asString(trace.events[0]?.locals?.profileId)
    );
}

function inferSchemaMode(event: InlineCompletionDebugEvent | undefined): string | undefined {
    const overrideProfile = event?.overridesApplied.schemaContext?.budgetProfile;
    if (typeof overrideProfile === "string") {
        return overrideProfile;
    }

    const formatted = event?.schemaContextFormatted;
    const match = formatted?.match(/schema\s+budget:\s+profile\s+([a-z-]+)/i);
    return match?.[1] ?? asString(event?.locals?.schemaBudgetProfile);
}

function inferSchemaSizeKind(event: InlineCompletionDebugEvent | undefined): string | undefined {
    return asString(event?.locals?.schemaSizeKind);
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isInlineCompletionDebugEvent(value: unknown): value is InlineCompletionDebugEvent {
    if (!isRecord(value)) {
        return false;
    }

    const stringFields = [
        "id",
        "documentUri",
        "documentFileName",
        "triggerKind",
        "completionCategory",
        "result",
        "rawResponse",
    ];
    const numberFields = [
        "timestamp",
        "line",
        "column",
        "latencyMs",
        "schemaObjectCount",
        "schemaSystemObjectCount",
        "schemaForeignKeyCount",
    ];
    const booleanFields = [
        "explicitFromUser",
        "intentMode",
        "inferredSystemQuery",
        "usedSchemaContext",
    ];

    if (
        !stringFields.every((field) => typeof value[field] === "string") ||
        !numberFields.every(
            (field) => typeof value[field] === "number" && Number.isFinite(value[field]),
        ) ||
        !booleanFields.every((field) => typeof value[field] === "boolean") ||
        !isRecord(value.overridesApplied) ||
        !isRecord(value.locals) ||
        !Array.isArray(value.promptMessages) ||
        !value.promptMessages.every(isPromptMessage)
    ) {
        return false;
    }

    return (
        isOptionalString(value.modelFamily) &&
        isOptionalString(value.modelId) &&
        isOptionalString(value.modelVendor) &&
        isOptionalNumber(value.inputTokens) &&
        isOptionalNumber(value.outputTokens) &&
        isOptionalString(value.sanitizedResponse) &&
        isOptionalString(value.finalCompletionText) &&
        isOptionalString(value.schemaContextFormatted) &&
        (value.tags === undefined || isStringRecord(value.tags)) &&
        (value.error === undefined || isTraceError(value.error))
    );
}

function isPromptMessage(value: unknown): boolean {
    return (
        isRecord(value) &&
        (value.role === "user" || value.role === "assistant") &&
        typeof value.content === "string"
    );
}

function isTraceError(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.message === "string" &&
        isOptionalString(value.name) &&
        isOptionalString(value.stack)
    );
}

function isStringRecord(value: unknown): boolean {
    return (
        isRecord(value) &&
        Object.values(value).every((entry) => entry === undefined || typeof entry === "string")
    );
}

function isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === "string";
}

function isOptionalNumber(value: unknown): boolean {
    return value === undefined || (typeof value === "number" && Number.isFinite(value));
}
