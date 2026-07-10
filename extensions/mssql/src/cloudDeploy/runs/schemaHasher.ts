/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — schema hasher.
 *
 * Computes a stable content fingerprint of a schema source so each run can be
 * stamped with a `SourceVersion`. The hash is the universal identity that lets
 * runs be told apart and grouped: the same schema always produces the same
 * hash, a changed schema produces a different one. It is a FINGERPRINT, not a
 * copy — it answers "same or different schema?", never "what was in the
 * schema?" (that stays git's job).
 *
 * Two hashing paths, mirroring the source-of-truth kinds:
 *   * `SqlProj` — hash the schema SOURCE FILES (the `.sqlproj` plus every `.sql`
 *     under the project directory), excluding build output. No build required,
 *     so it works even when the schema does not build.
 *   * `Dacpac` — hash the compiled artifact's bytes directly (it has no source
 *     files to enumerate).
 *
 * Determinism is the whole point, so two rules are enforced when hashing source
 * files: paths are sorted (project-relative, forward-slash normalized) and file
 * content is line-ending-normalized (CRLF/CR → LF, leading BOM stripped). That
 * keeps the hash identical for the same content on Windows and in CI — the
 * local↔CI bridge this enables.
 */

import { createHash } from "crypto";

import { SourceOfTruth, SourceOfTruthKind } from "../environments/types";
import { SourceVersion } from "./types";

// =============================================================================
// Constants
// =============================================================================

/** Hash algorithm. Stamped onto `SourceVersion.algorithm` so a future change is detectable. */
const HASH_ALGORITHM = "sha256" as const;

/** NUL byte separator between a file's path and its content, and between files. */
const SEPARATOR = "\0";

// =============================================================================
// Public types
// =============================================================================

/**
 * One schema source file feeding the hash. `relativePath` is the file's path
 * relative to the schema root (sorted + forward-slash normalized before
 * hashing so a rename changes the hash); `content` is the raw file bytes
 * (line-ending-normalized before hashing).
 */
export interface SchemaFile {
    readonly relativePath: string;
    readonly content: Buffer;
}

/**
 * Host seam for gathering a schema's source files. Kept separate from the
 * pure hashing functions so the runner can wire a real fs-backed lister while
 * unit tests inject a fake. Listing excludes build output (`bin/`, `obj/`).
 */
export interface SchemaSourceReader {
    /**
     * Lists the schema source files under `projectDirectory` as `SchemaFile`s
     * (each carrying a project-relative path and its content). Implementations
     * MUST exclude build-output directories (`bin/`, `obj/`).
     */
    listSqlProjFiles(projectDirectory: string): Promise<SchemaFile[]>;
    /** Reads the whole contents of a file as a `Buffer` (for the dacpac path). */
    readFileBuffer(filePath: string): Promise<Buffer>;
}

// =============================================================================
// Pure hashing core (no I/O — fully unit-testable)
// =============================================================================

/**
 * Hashes a set of schema source files into a `SourceVersion`. Pure: the same
 * files (by normalized path + normalized content) always yield the same hash,
 * regardless of input order or line-ending style.
 *
 * The digest folds, for each file in sorted path order:
 * `normalizedPath + NUL + normalizedContent + NUL`. The path is included so a
 * rename changes the hash; the NUL separators stop a path/content boundary
 * shift from colliding with a different split of the same bytes.
 */
export function hashSchemaFiles(files: readonly SchemaFile[]): SourceVersion {
    const normalized = files
        .map((file) => ({
            path: normalizePath(file.relativePath),
            content: normalizeLineEndings(file.content),
        }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const hash = createHash(HASH_ALGORITHM);
    for (const file of normalized) {
        hash.update(file.path);
        hash.update(SEPARATOR);
        hash.update(file.content);
        hash.update(SEPARATOR);
    }
    return { hash: `${HASH_ALGORITHM}:${hash.digest("hex")}`, algorithm: HASH_ALGORITHM };
}

/**
 * Hashes a compiled dacpac's raw bytes into a `SourceVersion`. A dacpac has no
 * source files to enumerate, so its bytes are the fingerprint directly. Not
 * line-ending-normalized — a dacpac is a binary artifact.
 */
export function hashDacpacBytes(bytes: Buffer): SourceVersion {
    const hash = createHash(HASH_ALGORITHM).update(bytes);
    return { hash: `${HASH_ALGORITHM}:${hash.digest("hex")}`, algorithm: HASH_ALGORITHM };
}

// =============================================================================
// SchemaHasher (wires source-of-truth → the right hashing path)
// =============================================================================

/**
 * Resolves a `SourceOfTruth` to a `SourceVersion` by dispatching to the right
 * hashing path. Takes a `SchemaSourceReader` so the fs access is injectable
 * (real lister in production, fake in tests).
 */
export class SchemaHasher {
    public constructor(private readonly _reader: SchemaSourceReader) {}

    /**
     * Computes the `SourceVersion` for `sourceOfTruth`:
     *   * `SqlProj` → list + hash the project's source files.
     *   * `Dacpac` → hash the artifact's bytes.
     *   * `Shadow` (with a projectPath) → list + hash the synced project's files.
     */
    public async hash(sourceOfTruth: SourceOfTruth): Promise<SourceVersion> {
        switch (sourceOfTruth.kind) {
            case SourceOfTruthKind.SqlProj: {
                const files = await this._reader.listSqlProjFiles(
                    projectDirectoryOf(sourceOfTruth.path),
                );
                return hashSchemaFiles(files);
            }
            case SourceOfTruthKind.Dacpac: {
                const bytes = await this._reader.readFileBuffer(sourceOfTruth.path);
                return hashDacpacBytes(bytes);
            }
            case SourceOfTruthKind.Connection: {
                // A live database has no on-disk source files to fingerprint and
                // no stable byte artifact (an extract is non-deterministic), so
                // the run is left unstamped. The runner treats a throw here as
                // "unstamped" rather than a run failure — the hash is metadata.
                throw new SchemaHashUnsupportedError(sourceOfTruth.kind);
            }
            case SourceOfTruthKind.Shadow: {
                // A shadow source with a projectPath has a real, deterministic
                // `.sql` tree on disk (the synced project), so fingerprint it
                // like a sqlproj — this lets workload baseline across re-syncs,
                // with a diff surfacing only when the decomposed schema actually
                // changed. A shadow without a projectPath (ephemeral, validate-
                // only) has nothing committed to fingerprint, so it stays
                // unstamped (the runner treats the throw as "unstamped").
                if (sourceOfTruth.projectPath === undefined) {
                    throw new SchemaHashUnsupportedError(sourceOfTruth.kind);
                }
                const files = await this._reader.listSqlProjFiles(sourceOfTruth.projectPath);
                return hashSchemaFiles(files);
            }
            default: {
                // `SourceOfTruth` is exhausted above (sqlproj + dacpac). This
                // guard surfaces a future additive kind that has no buildable
                // schema to fingerprint instead of silently returning nothing.
                const exhaustive: never = sourceOfTruth;
                throw new SchemaHashUnsupportedError(`${exhaustive}`);
            }
        }
    }
}

/** Thrown when a `SourceOfTruth` kind has no schema to fingerprint. */
export class SchemaHashUnsupportedError extends Error {
    public constructor(public readonly kind: string) {
        super(`Cannot compute a schema hash for source-of-truth kind "${kind}".`);
        this.name = "SchemaHashUnsupportedError";
    }
}

// =============================================================================
// Helpers (exported for direct unit testing)
// =============================================================================

/**
 * Normalizes a file path for hashing: backslashes → forward slashes so the
 * same project hashes identically on Windows and POSIX, with any leading
 * `./` stripped.
 */
export function normalizePath(filePath: string): string {
    const forward = filePath.replace(/\\/g, "/");
    return forward.startsWith("./") ? forward.slice(2) : forward;
}

/**
 * Normalizes text content for hashing: strips a leading UTF-8 BOM and collapses
 * CRLF and lone CR to LF, so the same source hashes identically regardless of
 * the editor / OS that wrote it. Returns UTF-8 bytes.
 */
export function normalizeLineEndings(content: Buffer): Buffer {
    let text = content.toString("utf-8");
    if (text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1);
    }
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return Buffer.from(text, "utf-8");
}

/**
 * Resolves the project directory that contains a `.sqlproj` path. The schema's
 * source files live alongside the project file, so the directory is the root
 * we enumerate.
 */
function projectDirectoryOf(sqlprojPath: string): string {
    const normalized = sqlprojPath.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash === -1 ? "." : normalized.slice(0, lastSlash);
}
