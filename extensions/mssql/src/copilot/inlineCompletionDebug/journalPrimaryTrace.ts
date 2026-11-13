/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Journal-primary trace mechanics (WI-2.7, pure — no vscode imports so the
 * decision ladder and the v2 assembly are unit-testable end to end).
 *
 * Everything here is DORMANT unless the experimental
 * `mssql.copilot.inlineCompletions.trace.journalPrimary` flag is on AND the
 * capture journal binding is active (persistence=localJournal). With the
 * flag off, the callers in journalPrimaryPersistence.ts take the legacy v1
 * paths byte-identically — the addendum's rollback posture (§10.1).
 *
 * Two exports:
 *
 * 1. `resolveJournalPrimaryDeactivateDecision` — the documented decision
 *    ladder for skipping the legacy `mssql-copilot-trace-*.json` deactivate
 *    save. The legacy save is skipped ONLY when the journal is a provably
 *    healthy durable record for the whole epoch; ANY doubt keeps the legacy
 *    save (belt-and-braces, honest):
 *      1. flag off                                → legacy save;
 *      2. binding inactive                        → legacy save;
 *      3. linkless events were skipped            → legacy save (those events
 *         never reached the journal);
 *      4. no stream this epoch + ring empty       → skip (nothing captured);
 *         no stream this epoch + ring non-empty   → legacy save;
 *      5. any dropped record this epoch           → legacy save;
 *      6. writer state "failed"                   → legacy save;
 *      7. writer ok/degraded with zero drops      → SKIP the legacy save.
 *
 * 2. `assembleJournalPrimaryV2Trace` — explicit save/export assembly from a
 *    repository snapshot: journal flush barrier → read every stream of the
 *    current epoch → merge policy phases by captureEventId → compatibility
 *    projection → `serializeFeatureTraceV2`. Export fidelity can only
 *    REDUCE (§9.2): if ANY phase of the epoch was content-redacted the whole
 *    export is redacted (and the envelope's capture policy says so, with
 *    replayPayloadAvailable=false); the redactPrompts export option applies
 *    on top. Journal gaps surface as an explicit truncation block.
 */

import {
    FeatureCaptureJournalReadResult,
    readFeatureCaptureJournal,
} from "../../diagnostics/featureCapture/journal/journalReader";
import { JournalReducerState } from "../../diagnostics/featureCapture/journal/journalReducer";
import { JournalValidationIssue } from "../../diagnostics/featureCapture/journal/journalSchemas";
import { JournalFsLike } from "../../diagnostics/featureCapture/journal/journalWriter";
import { serializeFeatureTraceV2 } from "../../diagnostics/featureCapture/traceCodec";
import {
    FeatureTraceEnvelopeV2,
    FeatureTraceProvenance,
    RichCapturePolicySnapshot,
} from "../../sharedInterfaces/featureTrace";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugOverrides,
} from "../../sharedInterfaces/inlineCompletionDebug";
import {
    COMPLETIONS_JOURNAL_EVENT_SCHEMA,
    COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
    CompletionAcceptanceLiteV1,
    CompletionsJournalReducerState,
    projectJournalToCompletionEvents,
    redactCompletionEventForJournal,
} from "./completionsJournalProjection";
import { inlineCompletionTraceRedaction } from "./traceSerializer";

export type CompletionsTraceEnvelopeV2 = FeatureTraceEnvelopeV2<
    InlineCompletionDebugEvent,
    InlineCompletionDebugOverrides
>;

// ---------------------------------------------------------------------------
// Deactivate decision ladder
// ---------------------------------------------------------------------------

export interface JournalPrimaryDeactivateInput {
    /** mssql.copilot.inlineCompletions.trace.journalPrimary */
    journalPrimaryEnabled: boolean;
    /** Binding active = a persistence:"localJournal" policy is in force. */
    bindingActive: boolean;
    /** Streams opened for the current epoch (0 = nothing journaled yet). */
    epochStreamCount: number;
    ringEventCount: number;
    ringEvictedCount: number;
    /** Open writer state; undefined when no stream is currently open. */
    writerState?: "ok" | "degraded" | "failed";
    /** Epoch-wide dropped records (closed phases + the open writer). */
    epochDroppedRecords: number;
    /** Events skipped because they carried no durable link identity. */
    linklessSkipped: number;
}

export interface JournalPrimaryDeactivateDecision {
    /** True: the legacy deactivate trace file is NOT written. */
    skipLegacySave: boolean;
    /** Human-readable rung of the ladder, logged once by the caller. */
    reason: string;
}

export function resolveJournalPrimaryDeactivateDecision(
    input: JournalPrimaryDeactivateInput,
): JournalPrimaryDeactivateDecision {
    if (!input.journalPrimaryEnabled) {
        return { skipLegacySave: false, reason: "journalPrimary flag is off" };
    }
    if (!input.bindingActive) {
        return {
            skipLegacySave: false,
            reason: "capture journal is inactive (no localJournal policy in force)",
        };
    }
    if (input.linklessSkipped > 0) {
        return {
            skipLegacySave: false,
            reason: `${input.linklessSkipped} event(s) without durable identity never reached the journal`,
        };
    }
    if (input.epochStreamCount === 0) {
        if (input.ringEventCount === 0 && input.ringEvictedCount === 0) {
            return {
                skipLegacySave: true,
                reason: "nothing was captured this epoch (empty ring, no journal stream)",
            };
        }
        return {
            skipLegacySave: false,
            reason: "the ring holds events but no journal stream was opened this epoch",
        };
    }
    if (input.epochDroppedRecords > 0) {
        return {
            skipLegacySave: false,
            reason: `the journal dropped ${input.epochDroppedRecords} record(s) this epoch`,
        };
    }
    if (input.writerState === "failed") {
        return { skipLegacySave: false, reason: "the journal writer is in the failed state" };
    }
    return {
        skipLegacySave: true,
        reason:
            input.writerState === undefined
                ? "every journal stream of the epoch closed cleanly with zero drops"
                : `journal writer is ${input.writerState} with zero drops — the journal is the durable record`,
    };
}

// ---------------------------------------------------------------------------
// v2 export assembly
// ---------------------------------------------------------------------------

/**
 * The slice of FeatureCaptureJournalBinding the assembly needs (structural —
 * the real binding satisfies it; tests may inject a fake).
 */
export interface CompletionsJournalSource {
    readonly isActive: boolean;
    readonly activePolicy: RichCapturePolicySnapshot | undefined;
    readonly epochId: string;
    readonly hostSessionId: string;
    readonly currentEpochStreamDirectories: readonly string[];
    flushBarrier(): Promise<void>;
}

export interface AssembleJournalPrimaryTraceInput {
    source: CompletionsJournalSource;
    fs: JournalFsLike;
    /** Ring honesty inputs — a non-empty ring with no journal stream falls back. */
    ringEventCount: number;
    ringEvictedCount: number;
    overrides: InlineCompletionDebugOverrides;
    recordWhenClosed: boolean;
    extensionVersion: string;
    customPromptLastSavedAt: number | undefined;
    /** The trace.redactPrompts export option — applied ON TOP (§9.2). */
    redactPrompts: boolean;
    maxFileSizeMB?: number;
    provenance: FeatureTraceProvenance;
    exportedAt?: number;
    savedAt?: string;
}

export type AssembleJournalPrimaryTraceResult =
    | {
          kind: "v2";
          envelope: CompletionsTraceEnvelopeV2;
          /** Storage/lifecycle issues found while reading — logged, honest. */
          issues: JournalValidationIssue[];
      }
    | {
          kind: "fallbackLegacy";
          /** Why the caller must use the legacy v1 path — logged once. */
          reason: string;
      };

/**
 * Assemble the v2 trace from a consistent repository snapshot (§3.8: flush
 * barrier first, journal as the source of truth). Returns fallbackLegacy
 * whenever the journal cannot honestly represent the epoch — the caller then
 * writes the legacy v1 trace so nothing is lost. Never throws.
 */
export async function assembleJournalPrimaryV2Trace(
    input: AssembleJournalPrimaryTraceInput,
): Promise<AssembleJournalPrimaryTraceResult> {
    const { source, fs } = input;
    const policy = source.activePolicy;
    if (!source.isActive || !policy) {
        return { kind: "fallbackLegacy", reason: "capture journal is inactive" };
    }
    try {
        await source.flushBarrier();
        const directories = source.currentEpochStreamDirectories;
        if (directories.length === 0 && (input.ringEventCount > 0 || input.ringEvictedCount > 0)) {
            return {
                kind: "fallbackLegacy",
                reason: "the ring holds events but no journal stream was opened this epoch",
            };
        }

        const issues: JournalValidationIssue[] = [];
        const phases: CompletionsJournalReducerState[] = [];
        let journalDroppedRecords = 0;
        for (const directory of directories) {
            const result: FeatureCaptureJournalReadResult<
                InlineCompletionDebugEvent,
                InlineCompletionDebugEvent,
                CompletionAcceptanceLiteV1,
                Record<string, unknown>
            > = await readFeatureCaptureJournal(directory, { fs });
            phases.push(result.state);
            issues.push(...result.issues);
            journalDroppedRecords += result.manifest?.totals?.droppedRecords ?? 0;
        }

        const merged = mergeJournalPhases(phases);
        let events = projectJournalToCompletionEvents(
            merged as JournalReducerState<unknown, unknown, unknown, Record<string, unknown>>,
        );
        const omittedEvents = countPlaceholderOnlyEvents(merged);

        // §9.2 reduce-only fidelity: one content-redacted phase (or an
        // unreadable header, treated conservatively) redacts the WHOLE
        // export and the envelope's policy says so.
        let effectivePolicy = resolveEffectiveExportPolicy(policy, phases);
        if (effectivePolicy.fidelity !== "fullLocal") {
            events = events.map((event) => redactCompletionEventForJournal(event));
        }
        if (input.redactPrompts && effectivePolicy.replayPayloadAvailable) {
            // The export option strips prompts/responses below — an export
            // without payload must not advertise replayability (§9.2).
            effectivePolicy = {
                ...effectivePolicy,
                policyId: `${effectivePolicy.policyId}#export:redactPrompts`,
                replayPayloadAvailable: false,
            };
        }

        const envelope = serializeFeatureTraceV2<
            InlineCompletionDebugEvent,
            InlineCompletionDebugOverrides
        >(
            events,
            {
                featureId: "completions",
                hostSessionId: source.hostSessionId,
                captureSessionId: source.epochId,
                eventSchema: COMPLETIONS_JOURNAL_EVENT_SCHEMA,
                overridesSchema: COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
                extensionVersion: input.extensionVersion,
                overrides: input.overrides,
                capturePolicy: effectivePolicy,
                provenance: input.provenance,
                ...(input.exportedAt !== undefined ? { exportedAt: input.exportedAt } : {}),
                ...(input.savedAt !== undefined ? { savedAt: input.savedAt } : {}),
                extra: {
                    recordWhenClosed: input.recordWhenClosed,
                    customPromptLastSavedAt: input.customPromptLastSavedAt,
                },
            },
            {
                redact: input.redactPrompts,
                redaction: inlineCompletionTraceRedaction,
                ...(input.maxFileSizeMB !== undefined
                    ? { maxFileSizeMB: input.maxFileSizeMB }
                    : {}),
            },
        ) as CompletionsTraceEnvelopeV2;

        // Journal gaps stack with any size-cap truncation the serializer
        // already recorded — truncation is never silently absorbed.
        if (omittedEvents > 0 || journalDroppedRecords > 0) {
            envelope.truncation = {
                occurred: true,
                omittedEvents: (envelope.truncation?.omittedEvents ?? 0) + omittedEvents,
                firstRetainedAt:
                    envelope.truncation?.firstRetainedAt ?? envelope.events[0]?.timestamp,
            };
        }
        return { kind: "v2", envelope, issues };
    } catch (error) {
        return {
            kind: "fallbackLegacy",
            reason: `journal snapshot assembly failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Merge the epoch's policy phases into ONE read model per captureEventId
 * (a mid-epoch policy roll splits one logical event's lifecycle records
 * across sibling streams): first-arrival order, later phases refine —
 * created fills a gap, finalized wins, latest acceptance wins.
 */
export function mergeJournalPhases(
    phases: readonly CompletionsJournalReducerState[],
): CompletionsJournalReducerState {
    if (phases.length === 1) {
        return phases[0];
    }
    const order: string[] = [];
    const events: CompletionsJournalReducerState["events"] = new Map();
    for (const phase of phases) {
        for (const captureEventId of phase.order) {
            const model = phase.events.get(captureEventId);
            if (!model) {
                continue;
            }
            const existing = events.get(captureEventId);
            if (!existing) {
                order.push(captureEventId);
                events.set(captureEventId, { ...model });
                continue;
            }
            if (existing.createdValue === undefined && model.createdValue !== undefined) {
                existing.createdValue = model.createdValue;
                existing.createdAt = model.createdAt;
            }
            if (model.finalizedValue !== undefined) {
                existing.finalizedValue = model.finalizedValue;
                existing.finalizedAt = model.finalizedAt;
            }
            if (model.acceptance !== undefined) {
                existing.acceptance = model.acceptance;
                existing.acceptanceAt = model.acceptanceAt;
            }
        }
    }
    // The projection reads only order/events; the rest is inert scaffolding.
    return {
        header: phases[0]?.header,
        events,
        order,
        pendingAcceptances: new Map(),
        issues: [],
        recordsApplied: 0,
        recordsRejected: 0,
        unknownKindCount: 0,
        unknownSchemaCount: 0,
        lastRecordSeq: -1,
    };
}

/** Events whose created AND finalized values were both lost (no honest body). */
function countPlaceholderOnlyEvents(state: CompletionsJournalReducerState): number {
    let count = 0;
    for (const captureEventId of state.order) {
        const model = state.events.get(captureEventId);
        if (model && model.createdValue === undefined && model.finalizedValue === undefined) {
            count++;
        }
    }
    return count;
}

/**
 * Reduce-only export policy (§9.2): full fidelity may be claimed only when
 * EVERY phase header of the epoch (and the active policy) says fullLocal. A
 * redacted or unreadable phase demotes the whole export; the demoted policy
 * snapshot advertises replayPayloadAvailable=false.
 */
function resolveEffectiveExportPolicy(
    activePolicy: RichCapturePolicySnapshot,
    phases: readonly CompletionsJournalReducerState[],
): RichCapturePolicySnapshot {
    let demotedBy: RichCapturePolicySnapshot | undefined;
    let sawUnreadableHeader = false;
    for (const phase of phases) {
        const phasePolicy = phase.header?.capturePolicy;
        if (!phasePolicy) {
            sawUnreadableHeader = true;
            continue;
        }
        if (phasePolicy.fidelity !== "fullLocal" && !demotedBy) {
            demotedBy = phasePolicy;
        }
    }
    if (activePolicy.fidelity !== "fullLocal") {
        return activePolicy;
    }
    if (demotedBy) {
        return demotedBy;
    }
    if (sawUnreadableHeader) {
        return {
            ...activePolicy,
            policyId: `${activePolicy.policyId}#demoted:contentRedacted`,
            fidelity: "contentRedacted",
            replayPayloadAvailable: false,
        };
    }
    return activePolicy;
}
