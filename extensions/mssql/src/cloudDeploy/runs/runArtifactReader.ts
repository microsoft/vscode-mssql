/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — run-artifact reader.
 *
 * Symmetric counterpart to `RunArtifactWriter`. Loads a `.cdrun.zip` through
 * a `FileProvider`, parses it with `yauzl.fromBuffer`, and surfaces the
 * `RunRecord` via `read()` and the optional event log via `readEvents()`.
 *
 * Failure handling is fail-closed and typed:
 *   * Any non-zip bytes → `RunArtifactParseError { kind: "malformed-zip" }`.
 *   * Missing `manifest.json` → `kind: "missing-entry"`.
 *   * `schemaVersion` we don't recognize → `kind: "unknown-schema-version"`.
 *   * Anything else schema-wise → `kind: "schema-validation"` with `issues`.
 *   * Provider I/O failure → `kind: "io"`.
 *
 * Diagnostic events in `events.jsonl` are best-effort: malformed lines are
 * skipped rather than aborting the read, since events are advisory and
 * losing one event must never make a run unreadable.
 */

import * as yauzl from "yauzl";

import { DiagnosticEvent } from "../diagnostics/types";
import { FileProvider } from "../providers";
import { RUN_EVENTS_ENTRY, RUN_MANIFEST_ENTRY } from "./runArtifactWriter";
import { RunRecord } from "./types";
import { RunArtifactParseError, validateRunRecord } from "./runArtifactSchema";

// =============================================================================
// RunArtifactReader
// =============================================================================

export class RunArtifactReader {
    public constructor(private readonly _fileProvider: FileProvider) {}

    /**
     * Reads, parses, and validates the run artifact at `artifactPath`.
     * Throws `RunArtifactParseError` for every recoverable failure mode;
     * inspect `.kind` to differentiate.
     */
    public async read(artifactPath: string): Promise<RunRecord> {
        const buffer = await this.readBuffer(artifactPath);
        const entries = await readZipEntries(buffer, artifactPath);

        const manifestEntry = entries.get(RUN_MANIFEST_ENTRY);
        if (manifestEntry === undefined) {
            throw new RunArtifactParseError(
                artifactPath,
                "missing-entry",
                `Run artifact at ${artifactPath} is missing the required entry '${RUN_MANIFEST_ENTRY}'.`,
            );
        }

        let raw: unknown;
        try {
            raw = JSON.parse(manifestEntry.toString("utf8"));
        } catch (err) {
            throw new RunArtifactParseError(
                artifactPath,
                "schema-validation",
                `Run artifact at ${artifactPath} has a malformed '${RUN_MANIFEST_ENTRY}' (invalid JSON).`,
                undefined,
                undefined,
                err,
            );
        }

        return validateRunRecord(raw, artifactPath);
    }

    /**
     * Lazily yields diagnostic events from the optional `events.jsonl`
     * entry. Returns an empty stream when the entry is absent. Malformed
     * lines are skipped silently (events are advisory).
     */
    public async *readEvents(artifactPath: string): AsyncIterable<DiagnosticEvent> {
        const buffer = await this.readBuffer(artifactPath);
        const entries = await readZipEntries(buffer, artifactPath);

        const eventsEntry = entries.get(RUN_EVENTS_ENTRY);
        if (eventsEntry === undefined) {
            return;
        }

        const text = eventsEntry.toString("utf8");
        for (const line of text.split("\n")) {
            if (line.length === 0) {
                continue;
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(line);
            } catch {
                // Bad line — events are advisory, so we silently skip
                // rather than poisoning the whole iteration.
                continue;
            }
            // We trust the line shape minimally: an object with a string
            // `type`. Full Zod validation of every event would couple this
            // reader to the bus catalog; events are read-only history.
            if (isLikelyEvent(parsed)) {
                yield parsed as DiagnosticEvent;
            }
        }
    }

    /**
     * Centralized read so both `read()` and `readEvents()` use the same
     * I/O-failure mapping. ENOENT is rewrapped as `kind: "io"` (the file
     * the caller named doesn't exist).
     */
    private async readBuffer(artifactPath: string): Promise<Buffer> {
        try {
            return await this._fileProvider.readFileBuffer(artifactPath);
        } catch (err) {
            throw new RunArtifactParseError(
                artifactPath,
                "io",
                `Failed to read run artifact at ${artifactPath}: ${errorToMessage(err)}`,
                undefined,
                undefined,
                err,
            );
        }
    }
}

// =============================================================================
// Internals
// =============================================================================

/**
 * Parses the zip buffer into a map of `entryName -> entry contents`.
 *
 * The Phase-3 artifact layout is small (manifest + optional events.jsonl)
 * so buffering all entries upfront is fine; it also keeps the public
 * surface simple — neither `read()` nor `readEvents()` has to thread a
 * live zip handle around. If artifacts grow later (e.g.
 * per-validation files), this is the obvious extraction point for
 * a streaming entry iterator.
 */
function readZipEntries(buffer: Buffer, artifactPath: string): Promise<Map<string, Buffer>> {
    return new Promise<Map<string, Buffer>>((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
            if (err || !zipfile) {
                reject(
                    new RunArtifactParseError(
                        artifactPath,
                        "malformed-zip",
                        `Run artifact at ${artifactPath} is not a valid zip archive.`,
                        undefined,
                        undefined,
                        err ?? undefined,
                    ),
                );
                return;
            }

            const entries = new Map<string, Buffer>();
            zipfile.on("error", (zipErr) =>
                reject(
                    new RunArtifactParseError(
                        artifactPath,
                        "malformed-zip",
                        `Run artifact at ${artifactPath} could not be parsed: ${errorToMessage(zipErr)}`,
                        undefined,
                        undefined,
                        zipErr,
                    ),
                ),
            );
            zipfile.on("end", () => resolve(entries));

            zipfile.on("entry", (entry: yauzl.Entry) => {
                // Skip directories — the layout is flat, and a stray
                // directory entry in a malformed artifact must not stall
                // the reader.
                if (/\/$/.test(entry.fileName)) {
                    zipfile.readEntry();
                    return;
                }

                zipfile.openReadStream(entry, (streamErr, stream) => {
                    if (streamErr || !stream) {
                        reject(
                            new RunArtifactParseError(
                                artifactPath,
                                "malformed-zip",
                                `Run artifact at ${artifactPath} entry '${entry.fileName}' could not be opened: ${errorToMessage(streamErr)}`,
                                undefined,
                                undefined,
                                streamErr ?? undefined,
                            ),
                        );
                        return;
                    }
                    const chunks: Buffer[] = [];
                    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                    stream.on("end", () => {
                        entries.set(entry.fileName, Buffer.concat(chunks));
                        zipfile.readEntry();
                    });
                    stream.on("error", (streamReadErr) =>
                        reject(
                            new RunArtifactParseError(
                                artifactPath,
                                "malformed-zip",
                                `Run artifact at ${artifactPath} entry '${entry.fileName}' failed mid-read: ${errorToMessage(streamReadErr)}`,
                                undefined,
                                undefined,
                                streamReadErr,
                            ),
                        ),
                    );
                });
            });

            zipfile.readEntry();
        });
    });
}

/** Lightweight shape check — an object with a non-empty string `type`. */
function isLikelyEvent(value: unknown): boolean {
    if (value === null || typeof value !== "object") {
        return false;
    }
    const t = (value as { type?: unknown }).type;
    return typeof t === "string" && t.length > 0;
}

/** Mirror of writer's helper; kept local to avoid cross-file coupling. */
function errorToMessage(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }
    if (typeof err === "string") {
        return err;
    }
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}
