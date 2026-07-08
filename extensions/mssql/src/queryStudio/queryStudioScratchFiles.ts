/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio scratch files back generated script buffers with real .sql files.
 * That lets VS Code treat the generated text as the clean baseline while still
 * using normal TextDocument dirty tracking and hot-exit for later user edits.
 */

import * as path from "path";
import * as vscode from "vscode";
import { textHash } from "./textSync";

export const QUERY_STUDIO_SCRATCH_FOLDER = "query-studio-scratch";
export const QUERY_STUDIO_SCRATCH_METADATA_SUFFIX = ".qsmeta.json";

interface ScratchFileMetadata {
    version: 1;
    baselineHash: string;
    baselineLength: number;
    createdUtc: string;
    source?: string;
}

export type ScratchCleanupResult = "deleted" | "kept" | "skipped";

let scratchFileCounter = 0;

export function queryStudioScratchRoot(globalStorageUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(globalStorageUri, QUERY_STUDIO_SCRATCH_FOLDER);
}

export function queryStudioScratchTitle(initialSql: string, fallback = "Query Studio"): string {
    const firstMeaningfulLine =
        initialSql
            .split(/\r\n|\r|\n/g)
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? fallback;
    const collapsed = firstMeaningfulLine.replace(/\s+/g, " ");
    const sanitized = collapsed
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .replace(/[. ]+$/g, "")
        .trim();
    return (sanitized || fallback).slice(0, 64).replace(/[. ]+$/g, "") || fallback;
}

export function queryStudioScratchFileName(
    initialSql: string,
    now = new Date(),
    sequence = ++scratchFileCounter,
): string {
    const stamp = now
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
    const title = queryStudioScratchTitle(initialSql)
        .slice(0, 48)
        .replace(/[. ]+$/g, "");
    return `${title}-${stamp}-${sequence.toString(36)}.sql`;
}

export function queryStudioScratchMetadataUri(uri: vscode.Uri): vscode.Uri {
    return vscode.Uri.file(`${uri.fsPath}${QUERY_STUDIO_SCRATCH_METADATA_SUFFIX}`);
}

export function isQueryStudioScratchUri(uri: vscode.Uri, scratchRoot: vscode.Uri): boolean {
    if (uri.scheme !== "file" || scratchRoot.scheme !== "file") {
        return false;
    }
    const relative = path.relative(scratchRoot.fsPath, uri.fsPath);
    return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function shouldDeleteScratchFile(savedText: string, baselineHash: string): boolean {
    return textHash(savedText) === baselineHash;
}

export async function createQueryStudioScratchFile(
    scratchRoot: vscode.Uri,
    initialSql: string,
    source?: string,
): Promise<vscode.Uri> {
    await vscode.workspace.fs.createDirectory(scratchRoot);
    const uri = vscode.Uri.joinPath(scratchRoot, queryStudioScratchFileName(initialSql));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(initialSql, "utf8"));
    const metadata: ScratchFileMetadata = {
        version: 1,
        baselineHash: textHash(initialSql),
        baselineLength: initialSql.length,
        createdUtc: new Date().toISOString(),
        ...(source ? { source } : {}),
    };
    await vscode.workspace.fs.writeFile(
        queryStudioScratchMetadataUri(uri),
        Buffer.from(JSON.stringify(metadata, undefined, 2), "utf8"),
    );
    return uri;
}

export async function openQueryStudioScratchDocument(
    scratchRoot: vscode.Uri,
    initialSql: string,
    source?: string,
): Promise<vscode.TextDocument> {
    const uri = await createQueryStudioScratchFile(scratchRoot, initialSql, source);
    return vscode.workspace.openTextDocument(uri);
}

export async function cleanupQueryStudioScratchFile(
    uri: vscode.Uri,
    scratchRoot: vscode.Uri,
): Promise<ScratchCleanupResult> {
    if (!isQueryStudioScratchUri(uri, scratchRoot)) {
        return "skipped";
    }
    const metadata = await readScratchMetadata(uri);
    if (!metadata) {
        return "skipped";
    }
    let savedText: string;
    try {
        savedText = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    } catch {
        await deleteIfExists(queryStudioScratchMetadataUri(uri));
        return "deleted";
    }
    if (!shouldDeleteScratchFile(savedText, metadata.baselineHash)) {
        return "kept";
    }
    await deleteIfExists(uri);
    await deleteIfExists(queryStudioScratchMetadataUri(uri));
    return "deleted";
}

async function readScratchMetadata(uri: vscode.Uri): Promise<ScratchFileMetadata | undefined> {
    try {
        const raw = Buffer.from(
            await vscode.workspace.fs.readFile(queryStudioScratchMetadataUri(uri)),
        ).toString("utf8");
        const parsed = JSON.parse(raw) as Partial<ScratchFileMetadata>;
        if (parsed.version !== 1 || typeof parsed.baselineHash !== "string") {
            return undefined;
        }
        return {
            version: 1,
            baselineHash: parsed.baselineHash,
            baselineLength: typeof parsed.baselineLength === "number" ? parsed.baselineLength : 0,
            createdUtc: typeof parsed.createdUtc === "string" ? parsed.createdUtc : "",
            ...(typeof parsed.source === "string" ? { source: parsed.source } : {}),
        };
    } catch {
        return undefined;
    }
}

async function deleteIfExists(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.delete(uri, { useTrash: false });
    } catch {
        // Best-effort cleanup only; a failed delete must not affect editor close.
    }
}
