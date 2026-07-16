/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Host-side projection and lookup for the typed completions debug RPC (final
 * plan WI-1.2/WI-1.3): thin live-row projection, cursor paging over the live
 * ring, and section-lazy event detail for live and loaded-trace sources.
 *
 * PRIVACY: projectCompletionLiveRow constructs its row field-by-field —
 * never by spreading the event — so prompt/response/schema/locals content
 * structurally cannot ride a live-rows response (the shared contract also
 * carries a compile-time key guard). Content leaves this module only through
 * the explicitly content-bearing detail sections (prompt, rawResponse,
 * sanitizedResponse, schemaContext, locals, error).
 */

import { inlineCompletionDebugProfileOptions } from "../copilot/inlineCompletionDebug/inlineCompletionDebugProfiles";
import { inlineCompletionDebugStore } from "../copilot/inlineCompletionDebug/inlineCompletionDebugStore";
import { InlineCompletionTraceRepository } from "../copilot/inlineCompletionDebug/services/inlineCompletionTraceRepository";
import {
    formatModelDisplayName,
    formatModelSelector,
    parseModelSelector,
} from "../copilot/languageModels/shared/modelDisplay";
import {
    clampLiveRowsLimit,
    CompletionLiveRowV1,
    DcCompletionEventDetailParams,
    DcCompletionEventDetailResult,
    DcCompletionLiveRowsParams,
    DcCompletionLiveRowsResult,
    IcDetailSection,
} from "../sharedInterfaces/completionsDebugRpc";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugModelOption,
} from "../sharedInterfaces/inlineCompletionDebug";

// ---------------------------------------------------------------------------
// Thin live-row projection
// ---------------------------------------------------------------------------

/**
 * Project one captured event to its thin live row. Field-by-field on
 * purpose: never spread the event, never read locals — content stays behind
 * the lazy detail sections.
 */
export function projectCompletionLiveRow(
    event: InlineCompletionDebugEvent,
    availableModels: readonly InlineCompletionDebugModelOption[],
): CompletionLiveRowV1 {
    const row: CompletionLiveRowV1 = {
        eventId: event.id,
        timestamp: event.timestamp,
        result: event.result,
        trigger: event.triggerKind === "invoke" ? "invoke" : "automatic",
        detailAvailable: {
            prompt: (event.promptMessages?.length ?? 0) > 0,
            response:
                (typeof event.rawResponse === "string" && event.rawResponse.length > 0) ||
                typeof event.sanitizedResponse === "string" ||
                typeof event.finalCompletionText === "string",
            schema: typeof event.schemaContextFormatted === "string",
            locals: Object.keys(event.locals ?? {}).length > 0,
            error: event.error !== undefined,
        },
    };

    if (event.link) {
        row.captureEventId = event.link.captureEventId;
        row.captureSessionId = event.link.captureSessionId;
    }
    if (event.completionCategory !== undefined) {
        row.completionCategory = event.completionCategory;
    }
    const modelLabel = resolveCompletionModelLabel(event, availableModels);
    if (modelLabel !== undefined) {
        row.modelLabel = modelLabel;
    }
    const profileLabel = resolveCompletionProfileLabel(event);
    if (profileLabel !== undefined) {
        row.profileLabel = profileLabel;
    }
    if (typeof event.latencyMs === "number") {
        row.latencyMs = event.latencyMs;
    }
    if (typeof event.inputTokens === "number") {
        row.inputTokens = event.inputTokens;
    }
    if (typeof event.outputTokens === "number") {
        row.outputTokens = event.outputTokens;
    }
    if (event.result === "accepted") {
        row.acceptedState = "accepted";
    }
    if (event.tags?.replayRunId !== undefined) {
        row.replayRunId = event.tags.replayRunId;
    }
    // The human-readable cell label lives in locals (excluded by design);
    // the tagged cell id is the safe, stable label until it is promoted to a
    // typed field (addendum §5.2).
    if (event.tags?.replayMatrixCellId !== undefined) {
        row.matrixCellLabel = event.tags.replayMatrixCellId;
    }
    if (typeof event.documentFileName === "string" && event.documentFileName.length > 0) {
        row.documentFileName = event.documentFileName;
    }
    if (typeof event.line === "number") {
        row.line = event.line;
    }
    if (typeof event.column === "number") {
        row.column = event.column;
    }
    if (typeof event.intentMode === "boolean") {
        row.intentMode = event.intentMode;
    }
    if (event.error !== undefined) {
        row.error = true;
    }
    return row;
}

/**
 * Display label for the event's model, resolved through the shared model
 * display helpers and the capture service's catalog. Deliberately never
 * consults event.locals (content plane).
 */
function resolveCompletionModelLabel(
    event: InlineCompletionDebugEvent,
    availableModels: readonly InlineCompletionDebugModelOption[],
): string | undefined {
    if (event.modelVendor && event.modelId) {
        const selector = formatModelSelector({ vendor: event.modelVendor, id: event.modelId });
        const catalogOption = availableModels.find((model) => model.selector === selector);
        return (
            catalogOption?.label ??
            formatModelDisplayName({
                id: event.modelId,
                name: event.modelId,
                vendor: event.modelVendor,
            })
        );
    }

    const recorded = event.modelId ?? event.modelFamily;
    if (recorded) {
        return recorded;
    }

    const selector =
        event.completionCategory === "continuation"
            ? (event.overridesApplied?.continuationModelSelector ??
              event.overridesApplied?.modelSelector)
            : event.overridesApplied?.modelSelector;
    if (selector) {
        return parseModelSelector(selector)?.id ?? selector;
    }
    return undefined;
}

function resolveCompletionProfileLabel(event: InlineCompletionDebugEvent): string | undefined {
    const profileId = event.overridesApplied?.profileId;
    if (!profileId) {
        return undefined;
    }
    return (
        inlineCompletionDebugProfileOptions.find((option) => option.id === profileId)?.label ??
        profileId
    );
}

// ---------------------------------------------------------------------------
// Cursor paging over the live ring (newest rows first, cursor walks older)
// ---------------------------------------------------------------------------

export interface CompletionLiveRowsProjectionInput {
    /** Ring events in capture order (oldest first — the store's order). */
    events: readonly InlineCompletionDebugEvent[];
    availableModels: readonly InlineCompletionDebugModelOption[];
    params: DcCompletionLiveRowsParams | undefined;
    revision: number;
    droppedFromRing: boolean;
}

export function buildCompletionLiveRowsResult(
    input: CompletionLiveRowsProjectionInput,
): DcCompletionLiveRowsResult {
    const newestFirst = [...input.events].reverse();
    const limit = clampLiveRowsLimit(input.params?.limit);
    const start = resolveCursorStart(newestFirst, input.params?.cursor);
    const page = newestFirst.slice(start, start + limit);

    const result: DcCompletionLiveRowsResult = {
        rows: page.map((event) => projectCompletionLiveRow(event, input.availableModels)),
        revision: input.revision,
        totalCount: input.events.length,
        droppedFromRing: input.droppedFromRing,
    };
    if (page.length > 0 && start + page.length < newestFirst.length) {
        result.nextCursor = page[page.length - 1].id;
    }
    return result;
}

/**
 * Resolve the first newest-first index AFTER the cursor row. An exact ring-id
 * match wins; a cursor whose row was evicted resolves by ring ordinal (ids
 * are `<prefix>-<n>`); an unresolvable cursor yields an empty page — honest
 * end-of-data, never a silent restart from the newest rows.
 */
function resolveCursorStart(
    newestFirst: readonly InlineCompletionDebugEvent[],
    cursor: string | undefined,
): number {
    if (cursor === undefined) {
        return 0;
    }
    const exact = newestFirst.findIndex((event) => event.id === cursor);
    if (exact >= 0) {
        return exact + 1;
    }
    const cursorOrdinal = parseRingOrdinal(cursor);
    if (cursorOrdinal !== undefined) {
        const firstOlder = newestFirst.findIndex((event) => {
            const ordinal = parseRingOrdinal(event.id);
            return ordinal !== undefined && ordinal < cursorOrdinal;
        });
        if (firstOlder >= 0) {
            return firstOlder;
        }
    }
    return newestFirst.length;
}

function parseRingOrdinal(id: string): number | undefined {
    const match = /^[A-Za-z]+-(\d+)$/.exec(id);
    if (!match) {
        return undefined;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
}

// ---------------------------------------------------------------------------
// Section-lazy event detail
// ---------------------------------------------------------------------------

export interface CompletionEventDetailDeps {
    revision: number;
    availableModels: readonly InlineCompletionDebugModelOption[];
    /** Required for source.kind === "trace" lookups. */
    traceRepository?: InlineCompletionTraceRepository;
}

export async function resolveCompletionEventDetail(
    params: DcCompletionEventDetailParams,
    deps: CompletionEventDetailDeps,
): Promise<DcCompletionEventDetailResult> {
    const event = await findDetailEvent(params, deps.traceRepository);
    if (!event) {
        return { found: false, revision: deps.revision, sections: {} };
    }

    const sections: Partial<Record<IcDetailSection, unknown>> = {};
    for (const section of new Set(params.sections)) {
        sections[section] = projectDetailSection(event, section, deps.availableModels);
    }
    return { found: true, revision: deps.revision, sections };
}

async function findDetailEvent(
    params: DcCompletionEventDetailParams,
    traceRepository: InlineCompletionTraceRepository | undefined,
): Promise<InlineCompletionDebugEvent | undefined> {
    if (params.source.kind === "live") {
        return (
            inlineCompletionDebugStore.getEvent(params.eventId) ??
            inlineCompletionDebugStore.findByCaptureEventId(params.eventId)
        );
    }

    const loaded = await traceRepository?.getLoadedTrace(params.source.fileKey);
    return loaded?.trace.events.find(
        (event) => event.id === params.eventId || event.link?.captureEventId === params.eventId,
    );
}

/**
 * One event slice per section. summary/telemetry/overrides are the
 * metadata-only slices; prompt/rawResponse/sanitizedResponse/schemaContext/
 * locals/error are the content-bearing slices the caller asked for by name.
 */
function projectDetailSection(
    event: InlineCompletionDebugEvent,
    section: IcDetailSection,
    availableModels: readonly InlineCompletionDebugModelOption[],
): unknown {
    switch (section) {
        case "summary":
            return {
                row: projectCompletionLiveRow(event, availableModels),
                modelVendor: event.modelVendor,
                modelId: event.modelId,
                modelFamily: event.modelFamily,
                explicitFromUser: event.explicitFromUser,
                inferredSystemQuery: event.inferredSystemQuery,
                usedSchemaContext: event.usedSchemaContext,
                schemaObjectCount: event.schemaObjectCount,
                schemaSystemObjectCount: event.schemaSystemObjectCount,
                schemaForeignKeyCount: event.schemaForeignKeyCount,
                link: event.link,
                tags: event.tags,
            };
        case "prompt":
            return event.promptMessages;
        case "rawResponse":
            return event.rawResponse;
        case "sanitizedResponse":
            return {
                sanitizedResponse: event.sanitizedResponse,
                finalCompletionText: event.finalCompletionText,
            };
        case "schemaContext":
            return event.schemaContextFormatted;
        case "locals":
            return event.locals;
        case "telemetry":
            return {
                latencyMs: event.latencyMs,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
            };
        case "error":
            return event.error;
        case "overrides":
            return event.overridesApplied;
        default: {
            const exhaustive: never = section;
            return exhaustive;
        }
    }
}
