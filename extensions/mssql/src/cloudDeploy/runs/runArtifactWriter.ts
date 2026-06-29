/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — run-artifact writer.
 *
 * Builds a `.cdrun.zip` from a `RunRecord` plus an optional stream of
 * diagnostic events, then persists it atomically through a `FileProvider`.
 *
 * Layout (locked, additive only):
 *   * `manifest.json`        — pretty-printed `RunRecord` (authoritative).
 *   * `events.jsonl`         — one `DiagnosticEvent` per line, NDJSON
 *                              (omitted entirely when no events were emitted).
 *
 * The writer pre-validates the record against the Zod schema before it
 * writes anything, so a buggy producer never lands a malformed artifact on
 * disk. Success / failure is announced on the diagnostic bus when one is
 * supplied; the bus is optional so callers can write artifacts without a
 * bus configured (tests, future headless flows).
 */

import * as yazl from "yazl";

import type { DiagnosticEventSink } from "../diagnostics";
import { DiagnosticEvent } from "../diagnostics/types";
import { FileProvider } from "../providers";
import { RunRecord } from "./types";
import { validateRunRecord } from "./runArtifactSchema";

// =============================================================================
// Constants
// =============================================================================

/** Entry name of the authoritative run-record manifest inside the zip. */
export const RUN_MANIFEST_ENTRY = "manifest.json";
/** Entry name of the optional diagnostic event log inside the zip. */
export const RUN_EVENTS_ENTRY = "events.jsonl";

// =============================================================================
// RunArtifactWriter
// =============================================================================

/**
 * Result of a successful write. `path` is the absolute destination the
 * caller passed in; `sizeBytes` is the final zip size, which the bus also
 * reports in the `run-persisted` event.
 */
export interface RunArtifactWriteResult {
    readonly path: string;
    readonly sizeBytes: number;
}

export class RunArtifactWriter {
    public constructor(
        private readonly _fileProvider: FileProvider,
        private readonly _bus?: DiagnosticEventSink,
    ) {}

    /**
     * Builds and persists a run artifact at `destPath`. Drains `events`
     * synchronously (i.e. waits for the iterator to complete) before
     * writing, so the on-disk event log is final by the time the file
     * appears at its final path.
     *
     * Throws the underlying error on failure after emitting
     * `run-persist-failed`; the partial temp file (if any) is cleaned up
     * by `FileProvider.writeFileAtomic`.
     */
    public async write(
        record: RunRecord,
        events: AsyncIterable<DiagnosticEvent> | undefined,
        destPath: string,
    ): Promise<RunArtifactWriteResult> {
        try {
            // Pre-validate — never persist a malformed record. `safeParse`
            // is invoked internally; this throws `RunArtifactParseError`
            // on shape problems so the caller learns about its own bug
            // before the artifact lands on disk.
            validateRunRecord(record, destPath);

            const eventLines = await collectEvents(events);
            const zipBuffer = await buildZip(record, eventLines);

            await this._fileProvider.writeFileAtomic(destPath, zipBuffer);

            this._bus?.emit({
                source: "run-store",
                type: "run-persisted",
                payload: {
                    runId: record.runId,
                    path: destPath,
                    sizeBytes: zipBuffer.length,
                },
            });

            return { path: destPath, sizeBytes: zipBuffer.length };
        } catch (err) {
            this._bus?.emit({
                source: "run-store",
                severity: "error",
                type: "run-persist-failed",
                payload: {
                    runId: record.runId,
                    path: destPath,
                    cause: errorToMessage(err),
                },
            });
            throw err;
        }
    }
}

// =============================================================================
// Internals
// =============================================================================

/**
 * Drains an async iterable of events into NDJSON lines. Returns an empty
 * array when `events` is undefined so the writer can skip the entry
 * entirely (omitting an empty events.jsonl keeps trivial artifacts smaller).
 */
async function collectEvents(
    events: AsyncIterable<DiagnosticEvent> | undefined,
): Promise<string[]> {
    if (events === undefined) {
        return [];
    }
    const lines: string[] = [];
    for await (const event of events) {
        lines.push(JSON.stringify(event));
    }
    return lines;
}

/**
 * Builds the zip buffer in memory. We use `'data'` / `'end'` events on
 * yazl's output stream rather than `for await`-of so this stays portable
 * across `NodeJS.ReadableStream` typings, which don't always advertise
 * async-iterable surface.
 */
function buildZip(record: RunRecord, eventLines: readonly string[]): Promise<Buffer> {
    const zip = new yazl.ZipFile();
    const manifestBuf = Buffer.from(JSON.stringify(record, null, 2) + "\n", "utf8");
    zip.addBuffer(manifestBuf, RUN_MANIFEST_ENTRY);
    if (eventLines.length > 0) {
        const eventsBuf = Buffer.from(eventLines.join("\n") + "\n", "utf8");
        zip.addBuffer(eventsBuf, RUN_EVENTS_ENTRY);
    }
    zip.end();

    return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        zip.outputStream
            .on("data", (chunk: Buffer) => chunks.push(chunk))
            .on("end", () => resolve(Buffer.concat(chunks)))
            .on("error", reject);
    });
}

/** Best-effort stringification of an unknown error, safe for the bus payload. */
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
