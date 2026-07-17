/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completions ↔ journal compatibility layer (WI-2.4/2.5/2.6, pure — no
 * vscode imports so every piece is unit-testable):
 *
 * - the completions capture-policy snapshot built from the Amendment C
 *   settings mapping (`trace.captureEnabled=true → persistence=localJournal`,
 *   `trace.redactPrompts=true → fidelity=contentRedacted`; defaults
 *   unchanged — no other setting changes meaning);
 * - append-time journal redaction: the legacy trace redaction EXTENDED to
 *   cover `locals` string content and error message/stack, because journal
 *   records under a contentRedacted header must never carry plain text under
 *   a content-bearing key (the reducer's resurrection guard rejects such
 *   records — the writer side must satisfy it, §9.2);
 * - the simple acceptance value journaled by `acceptance.changed` (full
 *   §5.3 CompletionAcceptanceV1 typing arrives in Phase 4);
 * - `projectJournalToCompletionEvents`: the deterministic compatibility
 *   projection journal read model → InlineCompletionDebugEvent[] the
 *   Sessions dataset and reconciliation both use;
 * - the completions reconciliation adapter, including the documented digest
 *   subset (identity/outcome/metrics fields only — content fields are
 *   excluded so full and redacted streams reconcile identically).
 */

import {
    FEATURE_TRACE_REDACTED,
    FeatureTraceRedaction,
    cloneJson,
    redactValue,
} from "../../diagnostics/featureCapture/traceCodec";
import { CaptureReconciliationAdapter } from "../../diagnostics/featureCapture/journalReconciliation";
import { JournalReducerState } from "../../diagnostics/featureCapture/journal/journalReducer";
import {
    RICH_CAPTURE_POLICY_SCHEMA,
    RichCapturePolicySnapshot,
} from "../../sharedInterfaces/featureTrace";
import { InlineCompletionDebugEvent } from "../../sharedInterfaces/inlineCompletionDebug";
import { inlineCompletionTraceRedaction } from "./traceSerializer";

/** Schema ids frozen into the completions journal stream header. */
export const COMPLETIONS_JOURNAL_EVENT_SCHEMA = "mssql.inlineCompletionDebugEvent/1";
export const COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA = "mssql.inlineCompletionDebugOverrides/1";

/** The mutateEvent mutation-kind hint markAccepted threads (WI-2.4). */
export const COMPLETIONS_ACCEPTANCE_MUTATION_KIND = "acceptance";

/**
 * The acceptance.changed record value (deliberately minimal — WI-2.4). The
 * full CompletionAcceptanceV1 lifecycle object (§5.3: partial acceptance,
 * accepted characters/lines, more sources) lands with Phase 4; this shape is
 * forward-compatible with it (same field names, subset of values).
 */
export interface CompletionAcceptanceLiteV1 {
    state: "accepted";
    changedAt: number;
    source: "vscodeInlineApi";
}

export function createCompletionAcceptanceValue(changedAt: number): CompletionAcceptanceLiteV1 {
    return { state: "accepted", changedAt, source: "vscodeInlineApi" };
}

// ---------------------------------------------------------------------------
// Capture policy (Amendment C settings mapping)
// ---------------------------------------------------------------------------

export interface CompletionsCapturePolicyInput {
    /** mssql.copilot.inlineCompletions.trace.captureEnabled */
    traceCaptureEnabled: boolean;
    /** mssql.copilot.inlineCompletions.trace.redactPrompts */
    redactPrompts: boolean;
    /** Whether a viewer lease is currently armed (policy `source` honesty). */
    viewerArmed: boolean;
    activatedAt: number;
}

/**
 * Amendment C compatibility mapping, verbatim: captureEnabled=false keeps
 * persistence memoryOnly (binding inactive — the dark journal is OFF by
 * default); captureEnabled=true maps to localJournal; redactPrompts=true
 * maps to contentRedacted. No other setting changes meaning; the legacy
 * save-on-deactivate behavior of both settings is untouched (dual-write).
 */
export function buildCompletionsCapturePolicy(
    input: CompletionsCapturePolicyInput,
): RichCapturePolicySnapshot | undefined {
    if (!input.traceCaptureEnabled) {
        return undefined;
    }
    const fidelity = input.redactPrompts ? "contentRedacted" : "fullLocal";
    return {
        schema: RICH_CAPTURE_POLICY_SCHEMA,
        // policyId encodes every dimension that must roll the stream; source
        // and activatedAt are provenance, not identity.
        policyId: `completions.trace/1:localJournal:${fidelity}`,
        featureId: "completions",
        fidelity,
        persistence: "localJournal",
        source: input.viewerArmed ? "viewerLease" : "recordWhenClosed",
        activatedAt: input.activatedAt,
        replayPayloadAvailable: fidelity === "fullLocal",
    };
}

// ---------------------------------------------------------------------------
// Append-time journal redaction
// ---------------------------------------------------------------------------

/**
 * Journal redaction = the legacy completions trace redaction (prompts,
 * responses, formatted schema context) EXTENDED to satisfy the journal's
 * content-bearing-key contract — under a redacted stream header the reducer
 * rejects ANY plain string nested under a content-bearing key, so:
 * - `promptMessages` entries are tokenized WHOLE (role included — the guard
 *   treats every string under the key as content; message COUNT survives as
 *   the honest metric until roles are promoted out of the content block);
 * - every string nested under `locals` becomes the redaction token (numbers,
 *   booleans and structure survive so metrics-style locals remain useful);
 * - `error.message`/`error.stack` become the token (provider messages and
 *   stacks can carry user text/paths, §9.1).
 */
const journalRedaction: FeatureTraceRedaction = {
    redactedKeys: inlineCompletionTraceRedaction.redactedKeys,
    redactSpecial: (key, value) => {
        if (key === "promptMessages" && Array.isArray(value)) {
            return value.map((message) =>
                typeof message === "object" && message !== null
                    ? { role: FEATURE_TRACE_REDACTED, content: FEATURE_TRACE_REDACTED }
                    : FEATURE_TRACE_REDACTED,
            );
        }
        const special = inlineCompletionTraceRedaction.redactSpecial?.(key, value);
        if (special !== undefined) {
            return special;
        }
        if (key === "locals") {
            return redactStringsDeep(value);
        }
        if (key === "error" && typeof value === "object" && value !== null) {
            const error = value as { message?: unknown; name?: unknown; stack?: unknown };
            return {
                message: FEATURE_TRACE_REDACTED,
                ...(typeof error.name === "string" ? { name: error.name } : {}),
                ...(error.stack !== undefined ? { stack: FEATURE_TRACE_REDACTED } : {}),
            };
        }
        return undefined;
    },
};

function redactStringsDeep(value: unknown): unknown {
    if (typeof value === "string") {
        return value.length > 0 ? FEATURE_TRACE_REDACTED : value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactStringsDeep(item));
    }
    if (typeof value === "object" && value !== null) {
        const output: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            output[key] = redactStringsDeep(entry);
        }
        return output;
    }
    return value;
}

/** Applied by the binding to every record value under a redacted policy. */
export function redactCompletionEventForJournal(
    event: InlineCompletionDebugEvent,
): InlineCompletionDebugEvent {
    return redactValue(cloneJson(event), journalRedaction) as InlineCompletionDebugEvent;
}

// ---------------------------------------------------------------------------
// Compatibility projection (journal → InlineCompletionDebugEvent[])
// ---------------------------------------------------------------------------

export type CompletionsJournalReducerState = JournalReducerState<
    InlineCompletionDebugEvent,
    InlineCompletionDebugEvent,
    CompletionAcceptanceLiteV1,
    Record<string, unknown>
>;

/**
 * Deterministic compatibility projection: events in creation order, each the
 * latest lifecycle value (finalized wins over created), with a journaled
 * acceptance flipping a "success" result to "accepted" — exactly the ring's
 * markAccepted semantics. Events whose created AND finalized values were
 * both lost (placeholder-only read models) are skipped: there is no honest
 * event body to show.
 */
export function projectJournalToCompletionEvents(
    state: JournalReducerState<unknown, unknown, unknown, Record<string, unknown>>,
): InlineCompletionDebugEvent[] {
    const typed = state as CompletionsJournalReducerState;
    const projected: InlineCompletionDebugEvent[] = [];
    for (const captureEventId of typed.order) {
        const model = typed.events.get(captureEventId);
        if (!model) {
            continue;
        }
        const base = model.finalizedValue ?? model.createdValue;
        if (!base) {
            continue;
        }
        const event: InlineCompletionDebugEvent = { ...base };
        if (model.acceptance?.state === "accepted" && event.result === "success") {
            event.result = "accepted";
        }
        projected.push(event);
    }
    return projected;
}

// ---------------------------------------------------------------------------
// Reconciliation adapter (WI-2.6)
// ---------------------------------------------------------------------------

export function isTerminalCompletionResult(result: InlineCompletionDebugEvent["result"]): boolean {
    return result !== "pending" && result !== "queued";
}

/**
 * Digest subset (documented, normative for the reconciliation report):
 * identity, outcome, and metric fields only. Content fields — prompts,
 * responses, schema text, locals, error text — are EXCLUDED so that a
 * contentRedacted journal reconciles bit-for-bit against the unredacted
 * ring; content fidelity is proven by the append-time privacy canaries.
 */
export function completionEventDigestFields(
    event: InlineCompletionDebugEvent,
): Record<string, unknown> {
    return {
        captureEventId: event.link?.captureEventId,
        timestamp: event.timestamp,
        result: event.result,
        triggerKind: event.triggerKind,
        explicitFromUser: event.explicitFromUser,
        completionCategory: event.completionCategory,
        intentMode: event.intentMode,
        inferredSystemQuery: event.inferredSystemQuery,
        modelVendor: event.modelVendor,
        modelFamily: event.modelFamily,
        modelId: event.modelId,
        latencyMs: event.latencyMs,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        schemaObjectCount: event.schemaObjectCount,
        schemaSystemObjectCount: event.schemaSystemObjectCount,
        schemaForeignKeyCount: event.schemaForeignKeyCount,
        usedSchemaContext: event.usedSchemaContext,
        replayRunId: event.tags?.replayRunId,
        replayMatrixCellId: event.tags?.replayMatrixCellId,
        replaySourceEventId: event.tags?.replaySourceEventId,
        errorPresent: event.error !== undefined,
    };
}

export const completionsReconciliationAdapter: CaptureReconciliationAdapter<InlineCompletionDebugEvent> =
    {
        isTerminal: (event) => isTerminalCompletionResult(event.result),
        isAccepted: (event) => event.result === "accepted",
        isReplayTagged: (event) =>
            event.tags?.replayRunId !== undefined || event.tags?.replayTraceId !== undefined,
        projectJournal: (state) => projectJournalToCompletionEvents(state),
        digestFields: (event) => completionEventDigestFields(event),
    };
