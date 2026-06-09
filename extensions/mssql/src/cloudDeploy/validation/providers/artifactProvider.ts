/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — `ArtifactProvider` abstraction.
 *
 * Host-agnostic seam for "read a captured-workload file or a baseline-metrics
 * artifact from somewhere." `WorkloadPlaybackValidator` consumes it to load
 * the workload it's about to replay and the baseline it compares against;
 * any future validator that needs to consult an external blob (e.g. a
 * pre-computed plan-store snapshot) reuses the same interface.
 *
 * The contract is intentionally minimal — `read(uri)` returns the entire
 * artifact as a `Buffer`, `exists(uri)` is a cheap pre-flight. There is no
 * write path: validators consume artifacts, they do not produce them. The
 * production implementation (`LiveArtifactProvider`) delegates to the same
 * `FileProvider` abstraction that backs D3's run-artifact reader / writer,
 * so the slice has a single I/O abstraction shared by every consumer.
 *
 * The `uri` parameter is a string-typed local file path in Scope 1. A future
 * Scope-2 `GitHubArtifactProvider` slots into the same interface and parses
 * `gh://owner/repo/run/{id}/artifacts/{name}`-style URIs without any change
 * to the consumer (`WorkloadPlaybackValidator`) or the contract.
 *
 * Errors:
 *   * `ArtifactNotFoundError` — `read()` was called for a uri that does not
 *     exist. Distinct error class so validators can react with a typed
 *     `Skipped` result instead of bubbling a generic `Error`.
 *   * Any other I/O failure surfaces as a plain `Error`; validators re-throw
 *     so the runner classifies the result as `Errored`.
 */

import type { FileProvider } from "../../providers";

// =============================================================================
// Public types
// =============================================================================

/**
 * Provider interface. Two methods, both async, no streaming. Validators that
 * need richer access (range reads, partial decompression) can extend the
 * interface additively when a concrete need lands.
 */
export interface ArtifactProvider {
    /**
     * Reads the full artifact at `uri` as a `Buffer`. Throws
     * `ArtifactNotFoundError` when the artifact does not exist; any other
     * failure surfaces as a generic `Error`.
     */
    read(uri: string): Promise<Buffer>;

    /** Cheap pre-flight; never throws on a missing artifact. */
    exists(uri: string): Promise<boolean>;
}

/**
 * Thrown by `read()` when the artifact is not present. Carries the original
 * `uri` so callers can build a useful skipped-finding message without
 * needing to reconstruct it.
 */
export class ArtifactNotFoundError extends Error {
    public constructor(
        public readonly uri: string,
        message?: string,
    ) {
        super(message ?? `Artifact not found: ${uri}`);
        this.name = "ArtifactNotFoundError";
    }
}

// =============================================================================
// LiveArtifactProvider
// =============================================================================

/**
 * Production implementation. Treats `uri` as an absolute or workspace-relative
 * local file path and delegates I/O to the injected `FileProvider`. The
 * `FileProvider` is the same interface D3's run-artifact writer/reader uses,
 * so the production stack has a single fs seam.
 */
export class LiveArtifactProvider implements ArtifactProvider {
    public constructor(private readonly _files: FileProvider) {}

    public async read(uri: string): Promise<Buffer> {
        try {
            return await this._files.readFileBuffer(uri);
        } catch (err) {
            if (isEnoent(err)) {
                throw new ArtifactNotFoundError(uri);
            }
            throw err;
        }
    }

    public exists(uri: string): Promise<boolean> {
        return this._files.fileExists(uri);
    }
}

function isEnoent(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: unknown }).code === "ENOENT"
    );
}

// =============================================================================
// FakeArtifactProvider (test double)
// =============================================================================

/** Records every read so tests can assert which URIs were consulted. */
export interface FakeArtifactRead {
    readonly uri: string;
    readonly hit: boolean;
}

/**
 * In-memory implementation for unit tests. Tests `set()` artifacts up-front;
 * `read()` returns the stored `Buffer` (or throws `ArtifactNotFoundError`
 * for unset URIs); `exists()` returns whether a uri has been `set`. Every
 * `read` (hit or miss) is captured in `reads` so tests can assert which
 * artifacts the validator actually consulted, in order.
 */
export class FakeArtifactProvider implements ArtifactProvider {
    public readonly reads: FakeArtifactRead[] = [];
    private readonly _store = new Map<string, Buffer>();

    /**
     * Seeds an artifact at `uri`. Strings are stored as UTF-8 Buffers for
     * convenience (the workload-playback validator consumes JSON payloads,
     * which are easier to seed as strings).
     */
    public set(uri: string, contents: Buffer | string): void {
        const buf = typeof contents === "string" ? Buffer.from(contents, "utf-8") : contents;
        this._store.set(uri, buf);
    }

    public async read(uri: string): Promise<Buffer> {
        const buf = this._store.get(uri);
        this.reads.push({ uri, hit: buf !== undefined });
        if (buf === undefined) {
            throw new ArtifactNotFoundError(uri);
        }
        return buf;
    }

    public async exists(uri: string): Promise<boolean> {
        return this._store.has(uri);
    }
}
