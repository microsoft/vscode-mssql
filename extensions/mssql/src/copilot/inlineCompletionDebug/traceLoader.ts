/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completions trace loading over the generic trace-file helpers (B7): the
 * watcher, folder scan, and index mechanics are shared; this file owns the
 * completions facet inference (profile, schema mode, schema size kind) and
 * envelope field coercion (customPromptLastSavedAt).
 */

import * as fs from "fs";
import * as vscode from "vscode";
import { normalizeFeatureTraceFile } from "../../diagnostics/featureCapture/traceCodec";
import { DEFAULT_FEATURE_TRACE_LIMITS } from "../../sharedInterfaces/featureTrace";
import {
    FeatureTraceIndexEntryBase,
    createFeatureTraceFolderWatcher,
    indexFeatureTraceFile,
    scanFeatureTraceFolder,
} from "../../diagnostics/featureCapture/traceFiles";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugExportData,
    InlineCompletionDebugOverrides,
    InlineCompletionDebugTraceIndexEntry,
} from "../../sharedInterfaces/inlineCompletionDebug";
import { TRACE_FILE_PREFIX } from "./tracePersistence";

const NAMING = { filePrefix: TRACE_FILE_PREFIX };

export function createTraceFolderWatcher(
    folder: string,
    onDidChange: () => void,
): vscode.FileSystemWatcher {
    return createFeatureTraceFolderWatcher(NAMING, folder, onDidChange);
}

const SCAN_OPTIONS = {
    naming: NAMING,
    loadFile: loadTraceFile,
    createIndexEntry: (
        base: FeatureTraceIndexEntryBase,
        trace: InlineCompletionDebugExportData,
    ): InlineCompletionDebugTraceIndexEntry => ({
        ...base,
        sourceKind: base.imported ? "imported" : "folder",
        profile: inferProfile(trace),
        schemaMode: inferSchemaMode(trace.events[0]),
        schemaSizeKind: inferSchemaSizeKind(trace.events[0]),
    }),
    createErrorEntry: (base: FeatureTraceIndexEntryBase): InlineCompletionDebugTraceIndexEntry => ({
        ...base,
        sourceKind: base.imported ? "imported" : "folder",
    }),
};

export async function scanTraceFolder(
    folder: string,
    includedFileKeys: ReadonlySet<string> = new Set(),
    loadedFileKeys: ReadonlySet<string> = new Set(),
): Promise<InlineCompletionDebugTraceIndexEntry[]> {
    return scanFeatureTraceFolder(folder, {
        ...SCAN_OPTIONS,
        includedFileKeys,
        loadedFileKeys,
    });
}

export async function indexTraceFile(
    filePath: string,
    options: { included: boolean; loaded: boolean; imported: boolean },
): Promise<InlineCompletionDebugTraceIndexEntry> {
    const { indexEntry } = await indexFeatureTraceFile(filePath, SCAN_OPTIONS, options);
    return indexEntry;
}

export async function loadTraceFile(filePath: string): Promise<InlineCompletionDebugExportData> {
    // Untrusted-import byte cap enforced BEFORE reading (WI-0.5 / addendum §9.3).
    const stat = await fs.promises.stat(filePath);
    if (stat.size > DEFAULT_FEATURE_TRACE_LIMITS.maxFileBytes) {
        throw new Error(
            `${filePath} is ${stat.size} bytes — over the ` +
                `${DEFAULT_FEATURE_TRACE_LIMITS.maxFileBytes}-byte trace import limit.`,
        );
    }

    const contents = await fs.promises.readFile(filePath, "utf8");
    return normalizeTraceFile(JSON.parse(contents), filePath);
}

export function normalizeTraceFile(
    value: unknown,
    source: string,
): InlineCompletionDebugExportData {
    return normalizeFeatureTraceFile<InlineCompletionDebugEvent, InlineCompletionDebugOverrides>(
        value,
        source,
        {
            featureLabel: "an inline completion",
            expectedFeatureId: "completions",
            normalizeExtra: (raw) => ({
                customPromptLastSavedAt:
                    typeof raw.customPromptLastSavedAt === "number"
                        ? raw.customPromptLastSavedAt
                        : undefined,
            }),
        },
    ) as InlineCompletionDebugExportData;
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
