/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — host-agnostic file providers.
 *
 * Phase 3 introduces a narrow `FileProvider` interface so the run-artifact
 * writer and reader can be exercised against an in-memory fake without ever
 * touching disk. The local Node.js implementation lives here (`LocalFileProvider`)
 * and gives the production code path real fs semantics, including an atomic
 * `writeFileAtomic` (temp + rename) that mirrors the pattern already used by
 * the environments file layer.
 *
 * The interface is intentionally small: just the few operations the writer
 * and reader need. Later phases (notably D2's Local + GitHub artifact
 * providers and Phase 4a's broader store wiring) will expand it as required;
 * additive growth keeps the contract honest.
 */

import { promises as fs } from "fs";
import * as path from "path";

// =============================================================================
// Public interface
// =============================================================================

/**
 * Narrow host abstraction the run-artifact writer and reader depend on.
 *
 * The choice to operate on whole-file `Buffer`s — rather than streams — is
 * deliberate: run artifacts are bounded (a single user's single run), the
 * zip layout demands a complete buffer for `yauzl.fromBuffer`, and a buffer
 * surface is trivial to fake for unit tests.
 */
export interface FileProvider {
    /**
     * Reads the entire contents of a file as a `Buffer`. Implementations
     * MUST throw with `code === "ENOENT"` when the file does not exist so
     * callers can distinguish "missing" from other I/O failures.
     */
    readFileBuffer(filePath: string): Promise<Buffer>;

    /**
     * Atomically writes `data` to `filePath`. Implementations MUST guarantee
     * that callers never observe a half-written file at `filePath`: either
     * the previous version is intact, or the new version is fully present.
     * The parent directory is created on demand.
     */
    writeFileAtomic(filePath: string, data: Buffer): Promise<void>;

    /** Returns `true` iff `filePath` exists and is reachable for read. */
    fileExists(filePath: string): Promise<boolean>;
}

// =============================================================================
// LocalFileProvider
// =============================================================================

/**
 * Production `FileProvider` implementation backed by `node:fs/promises`.
 *
 * `writeFileAtomic` writes the payload to a sibling temp file then renames
 * it onto the destination. The temp filename is namespaced by pid + hi-res
 * timestamp + a small random suffix so concurrent writers within the same
 * process do not collide on the temp path.
 */
export class LocalFileProvider implements FileProvider {
    public async readFileBuffer(filePath: string): Promise<Buffer> {
        return fs.readFile(filePath);
    }

    public async writeFileAtomic(filePath: string, data: Buffer): Promise<void> {
        const dirPath = path.dirname(filePath);
        await fs.mkdir(dirPath, { recursive: true });

        const tempPath = path.join(
            dirPath,
            `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomSuffix()}.tmp`,
        );
        await fs.writeFile(tempPath, data);
        try {
            await fs.rename(tempPath, filePath);
        } catch (err) {
            // Best-effort cleanup; surface the rename failure as the cause.
            await fs.unlink(tempPath).catch(() => undefined);
            throw err;
        }
    }

    public async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Short alphanumeric suffix used to defuse temp-file collisions when many
 * writes happen within the same millisecond on the same pid. Not security
 * sensitive; `Math.random()` is plenty for collision avoidance.
 */
function randomSuffix(): string {
    return Math.random().toString(36).slice(2, 10);
}
