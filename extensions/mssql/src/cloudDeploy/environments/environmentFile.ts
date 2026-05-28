/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — environment file I/O.
 *
 * Reads and writes `.mssql/environments.json` for a given workspace folder.
 * Pure transport: parses JSON, runs the validator, returns typed objects.
 * No in-memory caching, no change events — those live in `environmentStore.ts`.
 *
 * Format: strict JSON (no comments). UTF-8, LF line endings, 4-space indent,
 * trailing newline. Writes are atomic (write-to-temp + rename).
 */

import * as path from "path";
import { promises as fs } from "fs";
import * as vscode from "vscode";

import { ENVIRONMENTS_FILE_SCHEMA_VERSION, EnvironmentsFile } from "./types";
import { validateEnvironmentsFile, type EnvironmentsFileIssue } from "./environmentSchema";

// =============================================================================
// Constants
// =============================================================================

const ENVIRONMENTS_DIR = ".mssql";
const ENVIRONMENTS_FILE_NAME = "environments.json";

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown when the environments file exists but cannot be parsed (syntax error,
 * non-JSON content, or fails schema validation). Carries enough context for a
 * caller (or the diagnostic event bus) to surface a useful message.
 *
 * For schema-validation failures, `issues` lists every problem found so users
 * can fix them in one editing pass instead of one-at-a-time.
 */
export class EnvironmentsFileParseError extends Error {
    /**
     * Populated for schema-validation failures (one entry per validator issue).
     * Left `undefined` for raw JSON-syntax failures, where the only diagnostic
     * is the underlying parser error captured in `cause` and `message`.
     */
    public issues?: EnvironmentsFileIssue[];

    public constructor(
        public readonly filePath: string,
        message: string,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = "EnvironmentsFileParseError";
    }
}

// =============================================================================
// Path helpers
// =============================================================================

/** Returns the URI of `.mssql/environments.json` for the given workspace folder. */
export function getEnvironmentsFileUri(folder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(folder.uri, ENVIRONMENTS_DIR, ENVIRONMENTS_FILE_NAME);
}

function getEnvironmentsFilePath(folder: vscode.WorkspaceFolder): string {
    return path.join(folder.uri.fsPath, ENVIRONMENTS_DIR, ENVIRONMENTS_FILE_NAME);
}

// =============================================================================
// Load
// =============================================================================

/**
 * Read and parse `.mssql/environments.json` for the given workspace folder.
 *
 * - If the file does not exist, returns an empty `EnvironmentsFile` in memory
 *   (the file is NOT created on disk; that happens on first save).
 * - If the file exists but is malformed, throws `EnvironmentsFileParseError`.
 */
export async function loadEnvironmentsFile(
    folder: vscode.WorkspaceFolder,
): Promise<EnvironmentsFile> {
    const filePath = getEnvironmentsFilePath(folder);

    let raw: string;
    try {
        raw = await fs.readFile(filePath, { encoding: "utf8" });
    } catch (err) {
        if (isNodeFsError(err) && err.code === "ENOENT") {
            return emptyEnvironmentsFile();
        }
        throw err;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new EnvironmentsFileParseError(
            filePath,
            `Failed to parse ${ENVIRONMENTS_FILE_NAME}: ${(err as Error).message}`,
            err,
        );
    }

    return validateEnvironmentsFile(parsed, filePath);
}

// =============================================================================
// Save
// =============================================================================

/**
 * Atomically write `.mssql/environments.json` for the given workspace folder.
 * Creates the `.mssql` directory if needed. Writes to a temp file in the same
 * directory, then renames into place — guarantees the file is never half-written.
 */
export async function saveEnvironmentsFile(
    folder: vscode.WorkspaceFolder,
    file: EnvironmentsFile,
): Promise<void> {
    const filePath = getEnvironmentsFilePath(folder);
    const dirPath = path.dirname(filePath);

    await fs.mkdir(dirPath, { recursive: true });

    const serialized = JSON.stringify(file, undefined, 4) + "\n";

    // Use a unique temp name in the same directory so `rename` is atomic
    // (cross-device renames on Windows can fall back to copy+delete).
    const tempPath = path.join(
        dirPath,
        `.${ENVIRONMENTS_FILE_NAME}.${process.pid}.${Date.now()}.tmp`,
    );

    await fs.writeFile(tempPath, serialized, { encoding: "utf8" });
    try {
        await fs.rename(tempPath, filePath);
    } catch (err) {
        // Best-effort cleanup; surface the original error.
        await fs.unlink(tempPath).catch(() => undefined);
        throw err;
    }
}

// =============================================================================
// Internal — empty file
// =============================================================================

function emptyEnvironmentsFile(): EnvironmentsFile {
    return {
        schemaVersion: ENVIRONMENTS_FILE_SCHEMA_VERSION,
        environments: [],
    };
}

// =============================================================================
// Internal — fs error narrowing
// =============================================================================

interface NodeFsError extends Error {
    code?: string;
}

function isNodeFsError(err: unknown): err is NodeFsError {
    return err instanceof Error && typeof (err as NodeFsError).code === "string";
}
