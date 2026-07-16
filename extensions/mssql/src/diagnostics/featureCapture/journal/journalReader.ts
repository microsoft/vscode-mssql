/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Feature-capture journal reader (final plan WI-2.1/2.2). Reads a stream
 * directory (child manifest + JSONL segments), verifies closed-segment
 * digests, tolerates the crash shapes the writer can legitimately leave
 * behind (torn final line, appended-but-not-checkpointed records, a missing
 * manifest), feeds the lifecycle reducer, and returns the read model with
 * every anomaly as an explicit validation issue — recoverability or an
 * honest `partial`, never a crash (fault-injection contract §13.5).
 */

import { createHash } from "crypto";
import {
    JournalReducerOptions,
    JournalReducerState,
    applyJournalRecord,
    createJournalReducerState,
} from "./journalReducer";
import {
    FEATURE_CAPTURE_MANIFEST_SCHEMA,
    FeatureCaptureJournalRecordV1,
    FeatureCaptureManifestV1,
    FeatureCaptureSegmentDescriptorV1,
    JournalValidationIssue,
    isJournalRecordShape,
} from "./journalSchemas";
import { JOURNAL_MANIFEST_FILE, JournalFsLike, NodeJournalFs, joinPath } from "./journalWriter";

const SEGMENT_FILE_PATTERN = /^segment-\d{6}\.jsonl$/;

export interface ReadFeatureCaptureJournalOptions {
    fs?: JournalFsLike;
    /** Verify closed-segment sha256 digests; on by default. */
    verifyDigests?: boolean;
    /** Passed through to the reducer (content keys, redaction token). */
    reducer?: Omit<JournalReducerOptions, "expectedGaps">;
}

export interface FeatureCaptureJournalReadResult<TCreated, TFinal, TAcceptance, TAnnotation> {
    state: JournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>;
    /** Storage-level issues first, then the reducer's lifecycle issues. */
    issues: JournalValidationIssue[];
    manifest?: FeatureCaptureManifestV1;
}

/** Read one journal stream directory into a reduced read model. Never throws. */
export async function readFeatureCaptureJournal<
    TCreated = unknown,
    TFinal = unknown,
    TAcceptance = unknown,
    TAnnotation = Record<string, unknown>,
>(
    directory: string,
    options: ReadFeatureCaptureJournalOptions = {},
): Promise<FeatureCaptureJournalReadResult<TCreated, TFinal, TAcceptance, TAnnotation>> {
    const fs = options.fs ?? new NodeJournalFs();
    const verifyDigests = options.verifyDigests ?? true;
    const storageIssues: JournalValidationIssue[] = [];

    const manifest = await readManifest(fs, directory, storageIssues);
    const segments = manifest ? manifest.segments : await scanSegments(fs, directory);

    const reducerOptions: JournalReducerOptions = {
        ...(options.reducer ?? {}),
        // Gaps the manifest already accounts for are evidence, not anomalies.
        expectedGaps: manifest?.droppedRanges ?? [],
    };
    const state = createJournalReducerState<TCreated, TFinal, TAcceptance, TAnnotation>();

    for (const segment of segments) {
        const path = joinPath(directory, segment.file);
        let content: string;
        try {
            content = await fs.readFile(path);
        } catch {
            storageIssues.push({
                // A sealed-empty segment (an interrupted first append) may
                // legitimately have no file behind it — nothing was lost.
                severity: segment.records > 0 ? "error" : "info",
                code: "segment.missing",
                message: `Segment ${segment.file} is missing or unreadable (${Math.max(segment.records, 0)} record(s) lost); loading the rest as partial evidence.`,
            });
            continue;
        }

        if (verifyDigests && segment.sha256) {
            const digest = createHash("sha256").update(content, "utf8").digest("hex");
            if (digest !== segment.sha256) {
                storageIssues.push({
                    severity: "error",
                    code: "segment.digestMismatch",
                    message: `Segment ${segment.file} content does not match its manifest sha256 digest; records are loaded but must be treated as unverified.`,
                });
            }
        }

        const lines = content.split("\n");
        // A trailing newline yields one empty final entry — the normal case.
        let parsedLines = 0;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex].trim();
            if (line.length === 0) {
                continue;
            }
            let value: unknown;
            try {
                value = JSON.parse(line);
            } catch {
                if (lineIndex === lines.length - 1) {
                    // Torn final line: an interrupted append. Tolerated.
                    storageIssues.push({
                        severity: "warning",
                        code: "segment.tornTailLine",
                        message: `Segment ${segment.file} ends with a torn partial line (interrupted write); the line was skipped.`,
                    });
                } else {
                    storageIssues.push({
                        severity: "error",
                        code: "segment.unreadable",
                        message: `Segment ${segment.file} line ${lineIndex + 1} is not valid JSON; the line was skipped.`,
                    });
                }
                continue;
            }
            parsedLines++;
            if (!isJournalRecordShape(value)) {
                storageIssues.push({
                    severity: "error",
                    code: "record.malformed",
                    message: `Segment ${segment.file} line ${lineIndex + 1} is not a journal record; the line was skipped.`,
                });
                continue;
            }
            applyJournalRecord(
                state,
                value as FeatureCaptureJournalRecordV1<TCreated, TFinal, TAcceptance, TAnnotation>,
                reducerOptions,
            );
        }

        if (manifest && parsedLines !== segment.records) {
            // Extra records beyond an ACTIVE manifest count are the normal
            // appended-but-not-checkpointed crash shape; anything else on a
            // digested (complete) segment is real disagreement.
            const severity = segment.sha256 && parsedLines < segment.records ? "error" : "info";
            storageIssues.push({
                severity,
                code: "segment.recordCountMismatch",
                message:
                    `Segment ${segment.file} holds ${parsedLines} record(s) but the manifest says ${segment.records}` +
                    (parsedLines > segment.records
                        ? " — records were appended after the last checkpoint (expected after an interrupted session)."
                        : "."),
            });
        }
    }

    return {
        state,
        issues: [...storageIssues, ...state.issues],
        manifest,
    };
}

async function readManifest(
    fs: JournalFsLike,
    directory: string,
    issues: JournalValidationIssue[],
): Promise<FeatureCaptureManifestV1 | undefined> {
    let raw: string;
    try {
        raw = await fs.readFile(joinPath(directory, JOURNAL_MANIFEST_FILE));
    } catch {
        issues.push({
            severity: "warning",
            code: "manifest.missing",
            message:
                "The stream manifest is missing (the writer never checkpointed); segments were discovered by directory scan.",
        });
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw) as FeatureCaptureManifestV1;
        if (
            typeof parsed !== "object" ||
            parsed === null ||
            parsed.schema !== FEATURE_CAPTURE_MANIFEST_SCHEMA ||
            !Array.isArray(parsed.segments)
        ) {
            issues.push({
                severity: "error",
                code: "manifest.malformed",
                message: `The stream manifest is not a valid "${FEATURE_CAPTURE_MANIFEST_SCHEMA}" document; segments were discovered by directory scan.`,
            });
            return undefined;
        }
        if (!Array.isArray(parsed.droppedRanges)) {
            parsed.droppedRanges = [];
        }
        return parsed;
    } catch {
        issues.push({
            severity: "error",
            code: "manifest.malformed",
            message:
                "The stream manifest is not valid JSON (possibly a torn write); segments were discovered by directory scan.",
        });
        return undefined;
    }
}

/** Manifest-less fallback: discover segments by name, in order. */
async function scanSegments(
    fs: JournalFsLike,
    directory: string,
): Promise<FeatureCaptureSegmentDescriptorV1[]> {
    const names = (await fs.readdir(directory))
        .filter((name) => SEGMENT_FILE_PATTERN.test(name))
        .sort();
    return names.map((file) => ({
        file,
        firstRecordSeq: 0,
        lastRecordSeq: 0,
        records: -1, // unknown — suppresses record-count comparison
        events: 0,
        bytes: 0,
        status: "closed" as const,
        capturePolicyId: "unknown",
    }));
}
