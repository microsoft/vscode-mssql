/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generic feature-trace file handling: naming, folder resolution, disk
 * writes, a folder watcher, and index scanning. The file format itself lives
 * in traceCodec.ts; feature-specific facet extraction (what shows in a trace
 * browser's columns) rides the `extractFacets` hook.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { getErrorMessage } from "../../utils/utils";
import { FeatureTraceEnvelope } from "./traceCodec";

export interface FeatureTraceIndexEntryBase {
    fileKey: string;
    filename: string;
    path: string;
    savedAt?: string;
    sessionId?: string;
    eventCount: number;
    dateRange?: { start: number; end: number };
    fileSizeBytes: number;
    included: boolean;
    loaded: boolean;
    imported: boolean;
    loadError?: string;
}

export interface FeatureTraceFileNaming {
    /** e.g. "mssql-copilot-trace-" or "mssql-querystudio-run-". */
    filePrefix: string;
}

export function createFeatureTraceFileName(
    naming: FeatureTraceFileNaming,
    savedAtIso: string = new Date().toISOString(),
): string {
    return `${naming.filePrefix}${savedAtIso.replace(/:/g, "-").replace(".", "-")}.json`;
}

export function isFeatureTraceFileName(naming: FeatureTraceFileNaming, filename: string): boolean {
    return filename.startsWith(naming.filePrefix) && filename.endsWith(".json");
}

export function featureTraceFileGlob(naming: FeatureTraceFileNaming): string {
    return `${naming.filePrefix}*.json`;
}

/**
 * Resolve a feature's trace folder: an explicitly configured path (with ~
 * expansion) or a default folder under the extension's global storage.
 */
export function resolveFeatureTraceFolder(
    configuredFolder: string | undefined,
    context: vscode.ExtensionContext,
    defaultFolderName: string,
): string {
    const configured = (configuredFolder ?? "").trim();
    if (configured.length === 0) {
        return vscode.Uri.joinPath(context.globalStorageUri, defaultFolderName).fsPath;
    }

    return expandHomePath(configured);
}

export function expandHomePath(folder: string): string {
    if (folder === "~") {
        return os.homedir();
    }

    if (folder.startsWith("~/") || folder.startsWith("~\\")) {
        return path.join(os.homedir(), folder.slice(2));
    }

    return folder;
}

/** mkdir -p + pretty-printed JSON write; returns the file path. */
export async function writeFeatureTraceFile(
    folder: string,
    fileName: string,
    trace: unknown,
): Promise<string> {
    await fs.promises.mkdir(folder, { recursive: true });
    const filePath = path.join(folder, fileName);
    fs.writeFileSync(filePath, JSON.stringify(trace, undefined, 2), "utf8");
    return filePath;
}

export function createFeatureTraceFolderWatcher(
    naming: FeatureTraceFileNaming,
    folder: string,
    onDidChange: () => void,
): vscode.FileSystemWatcher {
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(folder), featureTraceFileGlob(naming)),
    );
    watcher.onDidCreate(onDidChange);
    watcher.onDidChange(onDidChange);
    watcher.onDidDelete(onDidChange);
    return watcher;
}

export interface ScanFeatureTraceFolderOptions<TEvent, TOverrides, TIndexEntry> {
    naming: FeatureTraceFileNaming;
    loadFile: (filePath: string) => Promise<FeatureTraceEnvelope<TEvent, TOverrides>>;
    /** Feature facet extraction merged over the generic index fields. */
    createIndexEntry: (
        base: FeatureTraceIndexEntryBase,
        trace: FeatureTraceEnvelope<TEvent, TOverrides>,
    ) => TIndexEntry;
    /** Error-entry projection so a corrupt file still shows in the browser. */
    createErrorEntry: (base: FeatureTraceIndexEntryBase) => TIndexEntry;
    includedFileKeys?: ReadonlySet<string>;
    loadedFileKeys?: ReadonlySet<string>;
}

export async function scanFeatureTraceFolder<TEvent, TOverrides, TIndexEntry>(
    folder: string,
    options: ScanFeatureTraceFolderOptions<TEvent, TOverrides, TIndexEntry>,
): Promise<TIndexEntry[]> {
    const includedFileKeys = options.includedFileKeys ?? new Set<string>();
    const loadedFileKeys = options.loadedFileKeys ?? new Set<string>();
    let dirents: fs.Dirent[];
    try {
        dirents = await fs.promises.readdir(folder, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw error;
    }

    const withSavedAt = await Promise.all(
        dirents
            .filter((dirent) => dirent.isFile())
            .filter((dirent) => isFeatureTraceFileName(options.naming, dirent.name))
            .map(async (dirent) => {
                const filePath = path.join(folder, dirent.name);
                return indexFeatureTraceFile(filePath, options, {
                    included: includedFileKeys.size === 0 || includedFileKeys.has(filePath),
                    loaded: loadedFileKeys.has(filePath),
                    imported: false,
                });
            }),
    );

    return withSavedAt
        .sort((left, right) => (right.savedAt ?? "").localeCompare(left.savedAt ?? ""))
        .map((entry) => entry.indexEntry);
}

export async function indexFeatureTraceFile<TEvent, TOverrides, TIndexEntry>(
    filePath: string,
    options: ScanFeatureTraceFolderOptions<TEvent, TOverrides, TIndexEntry>,
    flags: { included: boolean; loaded: boolean; imported: boolean },
): Promise<{ indexEntry: TIndexEntry; savedAt?: string }> {
    const filename = path.basename(filePath);
    const stat = await fs.promises.stat(filePath);
    try {
        const trace = await options.loadFile(filePath);
        const timestamps = trace.events
            .map((event) => (event as { timestamp?: number }).timestamp)
            .filter((timestamp): timestamp is number => Number.isFinite(timestamp));
        const base: FeatureTraceIndexEntryBase = {
            fileKey: filePath,
            filename,
            path: filePath,
            savedAt: trace._savedAt,
            sessionId: path.basename(filePath, ".json"),
            eventCount: trace.events.length,
            dateRange:
                timestamps.length > 0
                    ? { start: Math.min(...timestamps), end: Math.max(...timestamps) }
                    : undefined,
            fileSizeBytes: stat.size,
            included: flags.included,
            loaded: flags.loaded,
            imported: flags.imported,
        };
        return { indexEntry: options.createIndexEntry(base, trace), savedAt: trace._savedAt };
    } catch (error) {
        const base: FeatureTraceIndexEntryBase = {
            fileKey: filePath,
            filename,
            path: filePath,
            eventCount: 0,
            fileSizeBytes: stat.size,
            included: flags.included,
            loaded: false,
            imported: flags.imported,
            loadError: getErrorMessage(error),
        };
        return { indexEntry: options.createErrorEntry(base) };
    }
}
