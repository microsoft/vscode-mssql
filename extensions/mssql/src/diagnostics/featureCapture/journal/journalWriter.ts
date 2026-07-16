/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Bounded, non-blocking feature-capture journal writer (final plan WI-2.2 /
 * addendum §3.7). The contract with the product hot path:
 *
 * - tryWrite() is synchronous, never throws, and performs NO file I/O —
 *   records are serialized into a queue bounded by BOTH record count and
 *   bytes (budget §14: enqueue p95 < 1ms excluding event construction);
 * - overflow drops the INCOMING record with EXACT recordSeq range
 *   accounting (dropping the newest keeps the on-disk stream a clean,
 *   reducible prefix; the manifest's droppedRanges tell the rest);
 * - a background loop (unref'd timer) batches appends, rolls segments by
 *   record count AND bytes, digests segments closed complete, and updates
 *   the child manifest via temp-file + atomic rename after every flush
 *   that changed state;
 * - durability claims stay honest: "appended" until the manifest agrees
 *   with the segments, "checkpointed" after — never "durable" (§3.7);
 * - total failure isolation: a throwing filesystem degrades the writer
 *   (ok → degraded → failed after consecutive failures) and every record
 *   that could not be persisted becomes an exact dropped range. The
 *   product never observes an exception.
 */

import { createHash, Hash } from "crypto";
import { logger2 } from "../../../models/logger2";
import {
    FEATURE_CAPTURE_MANIFEST_SCHEMA,
    FEATURE_CAPTURE_RECORD_SCHEMA,
    FEATURE_CAPTURE_STREAM_SCHEMA,
    FeatureCaptureDropReason,
    FeatureCaptureDroppedRangeV1,
    FeatureCaptureJournalEventRecordInputV1,
    FeatureCaptureJournalRecordV1,
    FeatureCaptureManifestV1,
    FeatureCaptureSegmentDescriptorV1,
    FeatureCaptureStreamHeaderInputV1,
    FeatureCaptureStreamHeaderRecordV1,
} from "./journalSchemas";

// ---------------------------------------------------------------------------
// Seams (injectable filesystem, clock, id factory)
// ---------------------------------------------------------------------------

/** Minimal filesystem surface the journal needs; tests inject a memory fake. */
export interface JournalFsLike {
    /** Recursive create; succeeds when the directory already exists. */
    mkdirp(path: string): Promise<void>;
    /** Append UTF-8 text, creating the file when missing. */
    appendFile(path: string, data: string): Promise<void>;
    /** Whole-file UTF-8 write (the temp file of the atomic manifest update). */
    writeFile(path: string, data: string): Promise<void>;
    /** Atomic same-directory replace. */
    rename(fromPath: string, toPath: string): Promise<void>;
    /** Rejects when the file does not exist. */
    readFile(path: string): Promise<string>;
    /** Immediate child names; empty array when the directory is missing. */
    readdir(path: string): Promise<string[]>;
}

/** Real implementation over node fs/promises. */
export class NodeJournalFs implements JournalFsLike {
    async mkdirp(path: string): Promise<void> {
        const fs = await import("fs/promises");
        await fs.mkdir(path, { recursive: true });
    }

    async appendFile(path: string, data: string): Promise<void> {
        const fs = await import("fs/promises");
        await fs.appendFile(path, data, "utf8");
    }

    async writeFile(path: string, data: string): Promise<void> {
        const fs = await import("fs/promises");
        await fs.writeFile(path, data, "utf8");
    }

    async rename(fromPath: string, toPath: string): Promise<void> {
        const fs = await import("fs/promises");
        await fs.rename(fromPath, toPath);
    }

    async readFile(path: string): Promise<string> {
        const fs = await import("fs/promises");
        return fs.readFile(path, "utf8");
    }

    async readdir(path: string): Promise<string[]> {
        const fs = await import("fs/promises");
        try {
            return await fs.readdir(path);
        } catch {
            return [];
        }
    }
}

export interface JournalClock {
    /** Epoch milliseconds. Product code uses Date.now; tests inject. */
    now(): number;
}

export const JOURNAL_MANIFEST_FILE = "manifest.json";

export interface FeatureCaptureJournalWriterOptions {
    /** Stream directory (e.g. <storeRoot>/rich/<feature>/<captureSessionId>). */
    directory: string;
    /** Stream identity + capture policy, frozen into the recordSeq-0 header. */
    header: FeatureCaptureStreamHeaderInputV1;
    /** Queue cap by records; incoming records past this are dropped. */
    maxQueueRecords?: number;
    /** Queue cap by serialized bytes. */
    maxQueueBytes?: number;
    /** Background flush interval. */
    flushIntervalMs?: number;
    /** Segment roll threshold by records. */
    segmentMaxRecords?: number;
    /** Segment roll threshold by bytes. */
    segmentMaxBytes?: number;
    /** Consecutive flush failures before the writer stops trying. */
    failureThreshold?: number;
    fs?: JournalFsLike;
    clock?: JournalClock;
    /** Temp-file suffix nonces; defaults to an internal counter. */
    idFactory?: () => string;
}

export const JOURNAL_WRITER_DEFAULTS = {
    maxQueueRecords: 2000,
    maxQueueBytes: 4 * 1024 * 1024,
    flushIntervalMs: 500,
    segmentMaxRecords: 5000,
    segmentMaxBytes: 8 * 1024 * 1024,
    failureThreshold: 5,
} as const;

export type JournalWriterState = "ok" | "degraded" | "failed";

export interface FeatureCaptureJournalWriterHealth {
    state: JournalWriterState;
    queueDepth: number;
    queuedBytes: number;
    droppedRangeCount: number;
    droppedRecords: number;
    lastAppendAt?: number;
    lastCheckpointAt?: number;
    /** Honest current claim (§3.7); this writer never claims "durable". */
    durabilityLevel: "appended" | "checkpointed";
    consecutiveFailures: number;
    failureDetail?: string;
}

interface QueuedRecord {
    recordSeq: number;
    kind: string;
    line: string;
    bytes: number;
}

interface ActiveSegment {
    descriptor: FeatureCaptureSegmentDescriptorV1;
    hash: Hash;
    /** False after any failed append — content is uncertain, no digest. */
    hashValid: boolean;
}

export class FeatureCaptureJournalWriter<
    TCreated = unknown,
    TFinal = unknown,
    TAcceptance = unknown,
    TAnnotation = Record<string, unknown>,
> {
    private readonly _logger = logger2.withPrefix("FeatureCaptureJournal");
    private readonly _directory: string;
    private readonly _header: FeatureCaptureStreamHeaderRecordV1;
    private readonly _fs: JournalFsLike;
    private readonly _clock: JournalClock;
    private readonly _idFactory: () => string;
    private readonly _maxQueueRecords: number;
    private readonly _maxQueueBytes: number;
    private readonly _flushIntervalMs: number;
    private readonly _segmentMaxRecords: number;
    private readonly _segmentMaxBytes: number;
    private readonly _failureThreshold: number;

    private _queue: QueuedRecord[] = [];
    private _queuedBytes = 0;
    private _nextSeq = 0;
    private _tempNonce = 0;

    private _directoryReady = false;
    private _segmentIndex = 0;
    private _activeSegment: ActiveSegment | undefined;
    private _closedSegments: FeatureCaptureSegmentDescriptorV1[] = [];
    private _droppedRanges: FeatureCaptureDroppedRangeV1[] = [];
    private _totals = { records: 0, events: 0, bytes: 0 };
    private _hadAppendFailure = false;
    private _appendedSinceCheckpoint = false;

    private _state: JournalWriterState = "ok";
    private _consecutiveFailures = 0;
    private _failureDetail: string | undefined;
    private _lastAppendAt: number | undefined;
    private _lastCheckpointAt: number | undefined;
    private _checkpointed = false;

    private _flushTimer: NodeJS.Timeout | undefined;
    private _flushChain: Promise<void> = Promise.resolve();
    private _closed = false;
    private _closedUtc: string | undefined;
    private readonly _createdUtc: string;

    constructor(options: FeatureCaptureJournalWriterOptions) {
        this._directory = options.directory;
        this._fs = options.fs ?? new NodeJournalFs();
        this._clock = options.clock ?? { now: () => Date.now() };
        this._idFactory = options.idFactory ?? (() => `${++this._tempNonce}`);
        this._maxQueueRecords = options.maxQueueRecords ?? JOURNAL_WRITER_DEFAULTS.maxQueueRecords;
        this._maxQueueBytes = options.maxQueueBytes ?? JOURNAL_WRITER_DEFAULTS.maxQueueBytes;
        this._flushIntervalMs = options.flushIntervalMs ?? JOURNAL_WRITER_DEFAULTS.flushIntervalMs;
        this._segmentMaxRecords =
            options.segmentMaxRecords ?? JOURNAL_WRITER_DEFAULTS.segmentMaxRecords;
        this._segmentMaxBytes = options.segmentMaxBytes ?? JOURNAL_WRITER_DEFAULTS.segmentMaxBytes;
        this._failureThreshold =
            options.failureThreshold ?? JOURNAL_WRITER_DEFAULTS.failureThreshold;

        this._createdUtc = options.header.createdUtc ?? new Date(this._clock.now()).toISOString();
        this._header = {
            schema: FEATURE_CAPTURE_RECORD_SCHEMA,
            kind: "stream.header",
            recordSeq: 0,
            featureId: options.header.featureId,
            hostSessionId: options.header.hostSessionId,
            captureSessionId: options.header.captureSessionId,
            eventSchema: options.header.eventSchema,
            overridesSchema: options.header.overridesSchema,
            capturePolicy: options.header.capturePolicy,
            createdUtc: this._createdUtc,
        };

        // The header is queued like any record (recordSeq 0); the constructor
        // performs no I/O — the first flush creates the directory and files.
        this.enqueue(this._header);
    }

    public get directory(): string {
        return this._directory;
    }

    public get header(): FeatureCaptureStreamHeaderRecordV1 {
        return this._header;
    }

    /**
     * Enqueue one lifecycle record. Synchronous, never throws, no file I/O.
     * Returns the assigned recordSeq and whether the record was accepted —
     * a rejected record's seq is part of an exact dropped range.
     */
    public tryWrite(
        record: FeatureCaptureJournalEventRecordInputV1<TCreated, TFinal, TAcceptance, TAnnotation>,
    ): { accepted: boolean; recordSeq: number } {
        const recordSeq = this._nextSeq;
        try {
            const full = {
                schema: FEATURE_CAPTURE_RECORD_SCHEMA,
                ...record,
                recordSeq,
            } as FeatureCaptureJournalRecordV1<TCreated, TFinal, TAcceptance, TAnnotation>;
            return { accepted: this.enqueue(full), recordSeq };
        } catch (error) {
            // Serialization failed (non-JSON value, circular reference, ...).
            // The seq is consumed and the drop is exact — never a throw.
            this._nextSeq = recordSeq + 1;
            this.recordDrop(recordSeq, "serializationError");
            this.noteFirstDrop(error);
            return { accepted: false, recordSeq };
        }
    }

    /**
     * Flush everything queued so far and update the manifest — the explicit
     * barrier for save/export/deactivate and tests. Never rejects; failures
     * surface through health().
     */
    public flushBarrier(): Promise<void> {
        return this.scheduleFlushNow();
    }

    /**
     * Final flush + finalize. The active segment is digested as closed ONLY
     * when complete (no append failures and nothing left unflushed) — status
     * honesty over tidy metadata. Idempotent.
     */
    public async close(): Promise<void> {
        if (this._closed) {
            await this._flushChain;
            return;
        }
        this._closed = true;
        this.cancelTimer();
        await this.scheduleFlushNow();

        this._flushChain = this._flushChain.then(async () => {
            // Records the final flush could not persist become exact drops.
            if (this._queue.length > 0) {
                for (const queued of this._queue) {
                    this.recordDrop(queued.recordSeq, "writerClosed");
                }
                this._queue = [];
                this._queuedBytes = 0;
            }
            this._closedUtc = new Date(this._clock.now()).toISOString();
            if (this._activeSegment) {
                this.sealActiveSegment();
            }
            await this.writeManifestSafely();
        });
        await this._flushChain;
    }

    /**
     * Cheap totals snapshot for catalog notifications (WI-2.4): what the
     * bundle descriptor needs — counts, bytes, drops, and the manifest-status
     * the next checkpoint would claim — without touching the filesystem.
     */
    public statsSnapshot(): {
        records: number;
        events: number;
        bytes: number;
        droppedRecords: number;
        status: "active" | "closed" | "partial";
    } {
        const droppedRecords = this._droppedRanges.reduce(
            (sum, range) => sum + (range.throughRecordSeq - range.fromRecordSeq + 1),
            0,
        );
        return {
            ...this._totals,
            droppedRecords,
            status: this._closed
                ? this._hadAppendFailure || this._state === "failed"
                    ? "partial"
                    : "closed"
                : "active",
        };
    }

    public health(): FeatureCaptureJournalWriterHealth {
        const droppedRecords = this._droppedRanges.reduce(
            (sum, range) => sum + (range.throughRecordSeq - range.fromRecordSeq + 1),
            0,
        );
        return {
            state: this._state,
            queueDepth: this._queue.length,
            queuedBytes: this._queuedBytes,
            droppedRangeCount: this._droppedRanges.length,
            droppedRecords,
            lastAppendAt: this._lastAppendAt,
            lastCheckpointAt: this._lastCheckpointAt,
            durabilityLevel:
                this._checkpointed && !this._appendedSinceCheckpoint && this._queue.length === 0
                    ? "checkpointed"
                    : "appended",
            consecutiveFailures: this._consecutiveFailures,
            ...(this._failureDetail ? { failureDetail: this._failureDetail } : {}),
        };
    }

    // -----------------------------------------------------------------------
    // Queue (synchronous side)
    // -----------------------------------------------------------------------

    private enqueue(
        record: FeatureCaptureJournalRecordV1<TCreated, TFinal, TAcceptance, TAnnotation>,
    ): boolean {
        const recordSeq = record.recordSeq;
        this._nextSeq = recordSeq + 1;

        if (this._closed) {
            this.recordDrop(recordSeq, "writerClosed");
            return false;
        }
        if (this._state === "failed") {
            // Failed writers keep exact drop accounting — honesty survives
            // the filesystem (§3.7 required behavior).
            this.recordDrop(recordSeq, "writerFailed");
            return false;
        }

        const line = JSON.stringify(record);
        const bytes = Buffer.byteLength(line, "utf8") + 1; // + newline

        if (this._queue.length >= this._maxQueueRecords) {
            this.recordDrop(recordSeq, "queueOverflowRecords");
            this.noteFirstDrop(undefined);
            return false;
        }
        if (this._queuedBytes + bytes > this._maxQueueBytes) {
            this.recordDrop(recordSeq, "queueOverflowBytes");
            this.noteFirstDrop(undefined);
            return false;
        }

        this._queue.push({ recordSeq, kind: record.kind, line, bytes });
        this._queuedBytes += bytes;
        this.scheduleTimer();
        return true;
    }

    /** Exact-range accounting: extend the last range or open a new one. */
    private recordDrop(recordSeq: number, reason: FeatureCaptureDropReason): void {
        const last = this._droppedRanges[this._droppedRanges.length - 1];
        if (last && last.reason === reason && last.throughRecordSeq === recordSeq - 1) {
            last.throughRecordSeq = recordSeq;
            return;
        }
        this._droppedRanges.push({
            fromRecordSeq: recordSeq,
            throughRecordSeq: recordSeq,
            reason,
        });
    }

    private noteFirstDrop(error: unknown): void {
        // Log on range starts only — never per record on the hot path.
        if (this._droppedRanges.length === 1) {
            const detail = error instanceof Error ? `: ${error.message}` : "";
            this._logger.warn(
                `Journal records are being dropped (exact ranges recorded in the manifest)${detail}`,
            );
        }
    }

    private scheduleTimer(): void {
        if (this._flushTimer || this._closed || this._state === "failed") {
            return;
        }
        this._flushTimer = setTimeout(() => {
            this._flushTimer = undefined;
            void this.scheduleFlushNow();
        }, this._flushIntervalMs);
        this._flushTimer.unref?.();
    }

    private cancelTimer(): void {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = undefined;
        }
    }

    // -----------------------------------------------------------------------
    // Flush loop (asynchronous side; serialized on a single chain)
    // -----------------------------------------------------------------------

    private scheduleFlushNow(): Promise<void> {
        this._flushChain = this._flushChain.then(() => this.doFlush());
        return this._flushChain;
    }

    /** One serialized flush pass. Never throws. */
    private async doFlush(): Promise<void> {
        if (this._state === "failed" || this._queue.length === 0) {
            return;
        }
        this.cancelTimer();

        if (!this._directoryReady) {
            try {
                await this._fs.mkdirp(this._directory);
                this._directoryReady = true;
            } catch (error) {
                this.noteFailure("creating the stream directory", error);
                return;
            }
        }

        const batch = this._queue;
        this._queue = [];
        this._queuedBytes = 0;

        let index = 0;
        while (index < batch.length) {
            const segment = this.ensureActiveSegment();
            // Take as many records as fit the segment caps — always at least
            // one, so an oversized single record still lands (in its own
            // over-cap segment, rolled immediately after).
            const chunk: QueuedRecord[] = [];
            let chunkBytes = 0;
            while (index < batch.length) {
                const candidate = batch[index];
                const wouldExceedRecords =
                    segment.descriptor.records + chunk.length + 1 > this._segmentMaxRecords;
                const wouldExceedBytes =
                    segment.descriptor.bytes + chunkBytes + candidate.bytes > this._segmentMaxBytes;
                if (chunk.length > 0 && (wouldExceedRecords || wouldExceedBytes)) {
                    break;
                }
                if (chunk.length === 0 && (wouldExceedRecords || wouldExceedBytes)) {
                    // Segment is at a cap already or the record alone exceeds
                    // the byte cap: take exactly one into a fresh/own slot
                    // only when the segment is empty; otherwise roll first.
                    if (segment.descriptor.records > 0) {
                        break;
                    }
                }
                chunk.push(candidate);
                chunkBytes += candidate.bytes;
                index++;
                if (
                    segment.descriptor.records + chunk.length >= this._segmentMaxRecords ||
                    segment.descriptor.bytes + chunkBytes >= this._segmentMaxBytes
                ) {
                    break;
                }
            }
            if (chunk.length === 0) {
                // Segment full: roll and try again.
                this.rollActiveSegment();
                continue;
            }

            const data = chunk.map((queued) => queued.line + "\n").join("");
            try {
                await this._fs.appendFile(joinPath(this._directory, segment.descriptor.file), data);
            } catch (error) {
                // Content of the active segment is now uncertain (a torn
                // line may exist). Seal it without a digest, roll to a fresh
                // segment, and requeue everything not yet appended.
                segment.hashValid = false;
                this._hadAppendFailure = true;
                this.sealActiveSegment();
                const remainder = [...chunk, ...batch.slice(index)];
                this._queue = [...remainder, ...this._queue];
                this._queuedBytes = this._queue.reduce((sum, queued) => sum + queued.bytes, 0);
                this.noteFailure("appending to the journal segment", error);
                await this.writeManifestSafely();
                return;
            }

            segment.hash.update(data, "utf8");
            const first = chunk[0];
            const last = chunk[chunk.length - 1];
            if (segment.descriptor.records === 0) {
                segment.descriptor.firstRecordSeq = first.recordSeq;
            }
            segment.descriptor.lastRecordSeq = last.recordSeq;
            segment.descriptor.records += chunk.length;
            segment.descriptor.events += chunk.filter(
                (queued) => queued.kind === "event.created",
            ).length;
            segment.descriptor.bytes += chunkBytes;
            this._totals.records += chunk.length;
            this._totals.events += chunk.filter((queued) => queued.kind === "event.created").length;
            this._totals.bytes += chunkBytes;
            this._lastAppendAt = this._clock.now();
            this._appendedSinceCheckpoint = true;

            if (
                segment.descriptor.records >= this._segmentMaxRecords ||
                segment.descriptor.bytes >= this._segmentMaxBytes
            ) {
                this.rollActiveSegment();
            }
        }

        // Appends all succeeded: recover from degraded, checkpoint the state.
        this._consecutiveFailures = 0;
        if (this._state === "degraded") {
            this._state = "ok";
            this._failureDetail = undefined;
        }
        await this.writeManifestSafely();

        // Records may have arrived while awaiting fs calls.
        if (this._queue.length > 0 && !this._closed) {
            this.scheduleTimer();
        }
    }

    private ensureActiveSegment(): ActiveSegment {
        if (!this._activeSegment) {
            this._segmentIndex++;
            this._activeSegment = {
                descriptor: {
                    file: `segment-${String(this._segmentIndex).padStart(6, "0")}.jsonl`,
                    firstRecordSeq: 0,
                    lastRecordSeq: 0,
                    records: 0,
                    events: 0,
                    bytes: 0,
                    status: "active",
                    capturePolicyId: this._header.capturePolicy.policyId,
                },
                hash: createHash("sha256"),
                hashValid: true,
            };
        }
        return this._activeSegment;
    }

    /** Roll after a cap: the segment is complete, so it gets its digest. */
    private rollActiveSegment(): void {
        this.sealActiveSegment();
    }

    /**
     * Seal the active segment. A digest is claimed ONLY when every append to
     * the segment succeeded — an uncertain segment stays digest-less and the
     * reader treats its content as honest-but-unverified.
     */
    private sealActiveSegment(): void {
        const segment = this._activeSegment;
        if (!segment) {
            return;
        }
        this._activeSegment = undefined;
        segment.descriptor.status = "closed";
        if (segment.hashValid && segment.descriptor.records > 0) {
            segment.descriptor.sha256 = segment.hash.digest("hex");
        }
        if (segment.descriptor.records > 0 || !segment.hashValid) {
            this._closedSegments.push(segment.descriptor);
        }
    }

    // -----------------------------------------------------------------------
    // Manifest (temp file + atomic rename; this writer is the only owner)
    // -----------------------------------------------------------------------

    private buildManifest(): FeatureCaptureManifestV1 {
        const segments = [...this._closedSegments];
        if (this._activeSegment && this._activeSegment.descriptor.records > 0) {
            segments.push({ ...this._activeSegment.descriptor });
        }
        const droppedRecords = this._droppedRanges.reduce(
            (sum, range) => sum + (range.throughRecordSeq - range.fromRecordSeq + 1),
            0,
        );
        const status: FeatureCaptureManifestV1["status"] = this._closed
            ? this._hadAppendFailure || this._state === "failed"
                ? "partial"
                : "closed"
            : "active";
        return {
            schema: FEATURE_CAPTURE_MANIFEST_SCHEMA,
            streamSchema: FEATURE_CAPTURE_STREAM_SCHEMA,
            stream: {
                featureId: this._header.featureId,
                hostSessionId: this._header.hostSessionId,
                captureSessionId: this._header.captureSessionId,
                eventSchema: this._header.eventSchema,
                overridesSchema: this._header.overridesSchema,
                capturePolicyId: this._header.capturePolicy.policyId,
            },
            status,
            // The manifest being written matches the segments it describes —
            // EXCEPT when an append failure left uncertain content behind.
            durability: this._hadAppendFailure ? "appended" : "checkpointed",
            segments,
            droppedRanges: [...this._droppedRanges],
            totals: { ...this._totals, droppedRecords },
            createdUtc: this._createdUtc,
            updatedUtc: new Date(this._clock.now()).toISOString(),
            ...(this._closedUtc ? { closedUtc: this._closedUtc } : {}),
        };
    }

    private async writeManifest(): Promise<void> {
        if (!this._directoryReady) {
            await this._fs.mkdirp(this._directory);
            this._directoryReady = true;
        }
        const manifestPath = joinPath(this._directory, JOURNAL_MANIFEST_FILE);
        const tempPath = `${manifestPath}.${this._idFactory()}.tmp`;
        await this._fs.writeFile(tempPath, JSON.stringify(this.buildManifest(), null, 2));
        await this._fs.rename(tempPath, manifestPath);
        this._lastCheckpointAt = this._clock.now();
        this._checkpointed = true;
        if (!this._hadAppendFailure) {
            this._appendedSinceCheckpoint = false;
        }
    }

    private async writeManifestSafely(): Promise<void> {
        try {
            await this.writeManifest();
        } catch (error) {
            // Appended data stays valid on disk; the stream is merely not
            // checkpointed. The old manifest (if any) remains intact because
            // the rename never landed.
            this.noteFailure("updating the journal manifest", error);
        }
    }

    // -----------------------------------------------------------------------
    // Failure isolation
    // -----------------------------------------------------------------------

    private noteFailure(action: string, error: unknown): void {
        this._consecutiveFailures++;
        this._failureDetail = `${action} failed: ${error instanceof Error ? error.message : String(error)}`;
        if (this._consecutiveFailures >= this._failureThreshold) {
            if (this._state !== "failed") {
                this._state = "failed";
                this._logger.error(
                    `Journal writer FAILED after ${this._consecutiveFailures} consecutive failures — ` +
                        `${this._failureDetail}. Further records are counted as exact dropped ranges.`,
                );
            }
            this.cancelTimer();
            // Queued records will never be persisted: exact drop accounting.
            for (const queued of this._queue) {
                this.recordDrop(queued.recordSeq, "writerFailed");
            }
            this._queue = [];
            this._queuedBytes = 0;
            return;
        }
        if (this._state === "ok") {
            this._state = "degraded";
            this._logger.warn(`Journal writer degraded — ${this._failureDetail}`);
        }
    }
}

/** Forward-slash join; segment files live directly in the stream directory. */
export function joinPath(directory: string, file: string): string {
    return directory.endsWith("/") || directory.endsWith("\\")
        ? `${directory}${file}`
        : `${directory}/${file}`;
}
