/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Typed, versioned RPC contract for the console-hosted Inline Completion
 * Debug experience (final plan WI-1.2/WI-1.3, addendum §6.2–§6.3). This is
 * the replacement for the full-state pull transport in debugConsole.ts
 * (DcIcDebugState/Action/Changed): commands are a discriminated union derived
 * from the reducer map, live rows are thin cursor-paged projections that
 * NEVER carry prompt/response/schema/locals content, event detail is fetched
 * lazily by section, and change notifications carry a state revision plus the
 * changed domains instead of an instruction to re-pull everything.
 *
 * The legacy trio keeps working unchanged until the webview migrates
 * (WI-1.4); everything here is additive.
 *
 * Everything in this file crosses the extension-host <-> webview boundary, so
 * it must stay JSON-serializable and free of runtime vscode imports.
 */

import { NotificationType, RequestType } from "vscode-jsonrpc";
import {
    InlineCompletionCategory,
    InlineCompletionDebugEventResult,
    InlineCompletionDebugReducers,
    inlineCompletionCategories,
    inlineCompletionDebugProfileIds,
    inlineCompletionSchemaBudgetProfileIds,
} from "./inlineCompletionDebug";

/**
 * Protocol version of this contract. The webview refuses to drive a host
 * whose major version it does not understand (capabilities handshake below).
 */
export const IC_DEBUG_PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Typed command union
// ---------------------------------------------------------------------------

/**
 * Discriminated command union over every reducer key — derived generically
 * from InlineCompletionDebugReducers so adding a reducer extends the union
 * (and the runtime validator table below fails to compile until it is
 * extended to match).
 */
export type IcDebugCommand = {
    [K in keyof InlineCompletionDebugReducers]: {
        name: K;
        payload: InlineCompletionDebugReducers[K];
    };
}[keyof InlineCompletionDebugReducers];

// ---------------------------------------------------------------------------
// Capabilities handshake
// ---------------------------------------------------------------------------

export interface DcIcDebugCapabilitiesResult {
    protocolVersion: number;
    /** Command names this host dispatches; everything else is stubbed. */
    enabledCommands: string[];
    /** False ⇒ the inline-completion feature gate is off (honest empties). */
    featureGateOn: boolean;
}

export namespace DcIcDebugCapabilitiesRequest {
    export const type = new RequestType<void, DcIcDebugCapabilitiesResult, void>(
        "dc/icDebugCapabilities",
    );
}

// ---------------------------------------------------------------------------
// Typed command dispatch
// ---------------------------------------------------------------------------

export interface DcIcDebugCommandParams {
    command: IcDebugCommand;
    /**
     * Advisory: the revision the sender last observed. Commands are never
     * rejected for staleness — the response's revision is the reconciliation
     * point (compare and re-pull when it moved past what you expected).
     */
    revision?: number;
}

export interface DcIcDebugCommandResult {
    /** Host revision after the command settled (or was rejected). */
    revision: number;
    /**
     * ok:false ⇒ the command was rejected before reaching any service
     * (malformed payload, unknown name, or not allowlisted on this host);
     * message says why.
     */
    validation?: { ok: boolean; message?: string };
}

export namespace DcIcDebugCommandRequest {
    export const type = new RequestType<DcIcDebugCommandParams, DcIcDebugCommandResult, void>(
        "dc/icDebugCommand",
    );
}

// ---------------------------------------------------------------------------
// Thin live rows (addendum §6.3) — NO prompt/response/schema/locals content
// ---------------------------------------------------------------------------

/**
 * Compact live-grid projection of one captured completion event. Content
 * fields (prompt messages, raw/sanitized responses, schema-context text,
 * locals, error text, document URIs/paths) never ride this row — only
 * detailAvailable flags say whether a lazy detail fetch would return them.
 */
export interface CompletionLiveRowV1 {
    /** Ring-local display ordinal (event.id) — the live detail lookup key. */
    eventId: string;
    /** Durable logical identity (link block), when captured with one. */
    captureEventId?: string;
    captureSessionId?: string;
    timestamp: number;
    result: InlineCompletionDebugEventResult;
    trigger: "automatic" | "invoke";
    completionCategory?: InlineCompletionCategory;
    modelLabel?: string;
    profileLabel?: string;
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    acceptedState?: string;
    replayRunId?: string;
    matrixCellLabel?: string;
    /** File NAME only, never a path — matches what the live grid shows. */
    documentFileName?: string;
    line?: number;
    column?: number;
    intentMode?: boolean;
    /** True when the event carries an error (text is detail-only). */
    error?: boolean;
    detailAvailable: {
        prompt: boolean;
        response: boolean;
        schema: boolean;
        locals: boolean;
        error: boolean;
    };
}

/**
 * Compile-time privacy guard: this alias only type-checks while
 * CompletionLiveRowV1 declares none of the event's content-bearing keys.
 */
type AssertNever<T extends never> = T;
export type CompletionLiveRowContentLeakGuard = AssertNever<
    Extract<
        keyof CompletionLiveRowV1,
        | "promptMessages"
        | "rawResponse"
        | "sanitizedResponse"
        | "finalCompletionText"
        | "schemaContextFormatted"
        | "locals"
        | "documentUri"
        | "overridesApplied"
    >
>;

export const COMPLETION_LIVE_ROWS_DEFAULT_LIMIT = 200;
export const COMPLETION_LIVE_ROWS_MAX_LIMIT = 1000;

/** Clamp a requested live-rows page size to the contract's bounds. */
export function clampLiveRowsLimit(limit: number | undefined): number {
    if (typeof limit !== "number" || !Number.isFinite(limit)) {
        return COMPLETION_LIVE_ROWS_DEFAULT_LIMIT;
    }
    return Math.min(COMPLETION_LIVE_ROWS_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export interface DcCompletionLiveRowsParams {
    /**
     * Omitted ⇒ the newest rows. Otherwise the eventId of the OLDEST row from
     * the previous page; the response continues backward from there (older
     * rows). Cursors that fell out of the ring resolve by ring ordinal.
     */
    cursor?: string;
    /** Page size; defaults to 200, hard-capped at 1000. */
    limit?: number;
}

export interface DcCompletionLiveRowsResult {
    /** Newest-first within the page. */
    rows: CompletionLiveRowV1[];
    revision: number;
    /** Events currently in the live ring (the pageable set). */
    totalCount: number;
    /** True when older live records were evicted from the ring this epoch. */
    droppedFromRing: boolean;
    /** Present while older rows remain; pass back as cursor. */
    nextCursor?: string;
}

export namespace DcCompletionLiveRowsRequest {
    export const type = new RequestType<
        DcCompletionLiveRowsParams,
        DcCompletionLiveRowsResult,
        void
    >("dc/completionLiveRows");
}

// ---------------------------------------------------------------------------
// Section-lazy event detail
// ---------------------------------------------------------------------------

export const icDetailSections = [
    "summary",
    "prompt",
    "rawResponse",
    "sanitizedResponse",
    "schemaContext",
    "locals",
    "telemetry",
    "error",
    "overrides",
] as const;

export type IcDetailSection = (typeof icDetailSections)[number];

export type DcCompletionEventDetailSource = { kind: "live" } | { kind: "trace"; fileKey: string };

export interface DcCompletionEventDetailParams {
    source: DcCompletionEventDetailSource;
    /** Live: ring id (falls back to captureEventId). Trace: event id or captureEventId. */
    eventId: string;
    sections: IcDetailSection[];
}

export interface DcCompletionEventDetailResult {
    found: boolean;
    revision: number;
    /** Only the requested sections, each carrying only that event slice. */
    sections: Partial<Record<IcDetailSection, unknown>>;
}

export namespace DcCompletionEventDetailRequest {
    export const type = new RequestType<
        DcCompletionEventDetailParams,
        DcCompletionEventDetailResult,
        void
    >("dc/completionEventDetail");
}

// ---------------------------------------------------------------------------
// Revision-stamped change notification (legacy dc/icDebugChanged still fires)
// ---------------------------------------------------------------------------

export const icDebugChangedDomains = ["live", "config", "sessions", "replay"] as const;

export type IcDebugChangedDomain = (typeof icDebugChangedDomains)[number];

export interface DcIcDebugChanged2Params {
    revision: number;
    /** Domains that changed since the last notification (canonical order). */
    changed: IcDebugChangedDomain[];
}

export namespace DcIcDebugChanged2Notification {
    export const type = new NotificationType<DcIcDebugChanged2Params>("dc/icDebugChanged2");
}

// ---------------------------------------------------------------------------
// Runtime command validation — table-driven shape/enum checks so malformed
// payloads are rejected BEFORE any service runs. Honest, not exhaustive: it
// verifies field types and closed-enum membership; deep object payloads
// (events, override records) are checked structurally, not semantically.
// ---------------------------------------------------------------------------

export type IcDebugCommandValidation =
    | { ok: true; command: IcDebugCommand }
    | { ok: false; message: string };

type FieldCheck = (value: unknown) => string | undefined;

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const aString: FieldCheck = (value) => (typeof value === "string" ? undefined : "must be a string");
const aBoolean: FieldCheck = (value) =>
    typeof value === "boolean" ? undefined : "must be a boolean";
const aFiniteNumber: FieldCheck = (value) =>
    typeof value === "number" && Number.isFinite(value) ? undefined : "must be a finite number";
const aNonNegativeInteger: FieldCheck = (value) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0
        ? undefined
        : "must be a non-negative integer";
const aRecord: FieldCheck = (value) => (isJsonRecord(value) ? undefined : "must be an object");

const nullOr =
    (check: FieldCheck): FieldCheck =>
    (value) =>
        value === null ? undefined : check(value);

const optional =
    (check: FieldCheck): FieldCheck =>
    (value) =>
        value === undefined ? undefined : check(value);

const oneOf =
    (values: readonly string[]): FieldCheck =>
    (value) =>
        typeof value === "string" && values.includes(value)
            ? undefined
            : `must be one of ${values.join(" | ")}`;

const arrayOf =
    (check: FieldCheck): FieldCheck =>
    (value) => {
        if (!Array.isArray(value)) {
            return "must be an array";
        }
        for (let index = 0; index < value.length; index++) {
            const problem = check(value[index]);
            if (problem) {
                return `[${index}] ${problem}`;
            }
        }
        return undefined;
    };

type PayloadCheck = (payload: Record<string, unknown>) => string | undefined;

/** Check named payload fields; unknown extra fields are tolerated. */
const fields =
    (spec: Record<string, FieldCheck>): PayloadCheck =>
    (payload) => {
        for (const [name, check] of Object.entries(spec)) {
            const problem = check(payload[name]);
            if (problem) {
                return `payload.${name} ${problem}`;
            }
        }
        return undefined;
    };

/** Any object payload (commands whose reducers take no arguments). */
const noArguments: PayloadCheck = () => undefined;

const replayCartConfigModes = [
    "snapshot",
    "override",
    "live",
] as const satisfies readonly InlineCompletionDebugReducers["queueReplayCart"]["configMode"][];

const copyEventPayloadKinds = [
    "id",
    "json",
    "prompt",
    "systemPrompt",
    "userPrompt",
    "rawResponse",
    "sanitizedResponse",
] as const satisfies readonly InlineCompletionDebugReducers["copyEventPayload"]["kind"][];

/** Partial InlineCompletionDebugOverrides: check the fields that are present. */
const partialOverridesShape: FieldCheck = (value) => {
    if (!isJsonRecord(value)) {
        return "must be an object";
    }
    const spec: Record<string, FieldCheck> = {
        profileId: nullOr(oneOf(inlineCompletionDebugProfileIds)),
        modelSelector: nullOr(aString),
        continuationModelSelector: nullOr(aString),
        useSchemaContext: nullOr(aBoolean),
        includeSqlDiagnostics: nullOr(aBoolean),
        debounceMs: nullOr(aFiniteNumber),
        maxTokens: nullOr(aFiniteNumber),
        enabledCategories: nullOr(arrayOf(oneOf(inlineCompletionCategories))),
        forceIntentMode: nullOr(aBoolean),
        customSystemPrompt: nullOr(aString),
        allowAutomaticTriggers: nullOr(aBoolean),
        schemaContext: nullOr(aRecord),
    };
    for (const [key, fieldValue] of Object.entries(value)) {
        const check = spec[key];
        if (!check || fieldValue === undefined) {
            continue;
        }
        const problem = check(fieldValue);
        if (problem) {
            return `.${key} ${problem}`;
        }
    }
    return undefined;
};

/** Captured event payloads: structural identity checks only. */
const eventShape: FieldCheck = (value) => {
    if (!isJsonRecord(value)) {
        return "must be an object";
    }
    if (typeof value.id !== "string") {
        return ".id must be a string";
    }
    if (typeof value.timestamp !== "number") {
        return ".timestamp must be a number";
    }
    return undefined;
};

/**
 * One shape check per reducer key. The Record type keeps this table
 * compile-time exhaustive: adding a reducer without a check will not build.
 */
const commandPayloadChecks: Record<keyof InlineCompletionDebugReducers, PayloadCheck> = {
    clearEvents: noArguments,
    selectEvent: fields({ eventId: optional(aString) }),
    updateOverrides: fields({ overrides: partialOverridesShape }),
    selectProfile: fields({ profileId: oneOf(inlineCompletionDebugProfileIds) }),
    setRecordWhenClosed: fields({ enabled: aBoolean }),
    openCustomPromptDialog: noArguments,
    closeCustomPromptDialog: noArguments,
    saveCustomPrompt: fields({ value: aString }),
    resetCustomPrompt: noArguments,
    refreshSchemaContext: noArguments,
    importSession: noArguments,
    exportSession: noArguments,
    saveTraceNow: noArguments,
    sessionsActivated: noArguments,
    sessionsRefresh: noArguments,
    sessionsToggleTrace: fields({ fileKey: aString, included: aBoolean }),
    sessionsSetAllTraces: fields({ included: aBoolean }),
    sessionsLoadIncluded: noArguments,
    sessionsAddFile: noArguments,
    sessionsChangeFolder: noArguments,
    sessionsEnableTraceCollection: noArguments,
    sessionsSyncToDatabase: noArguments,
    replayEvent: fields({ eventId: aString }),
    replaySessionEvent: fields({ event: eventShape }),
    openReplayBuilder: noArguments,
    closeReplayBuilder: fields({ restoreCart: aBoolean }),
    addEventsToReplayCart: fields({
        items: arrayOf((item) =>
            isJsonRecord(item) ? eventShape(item.event) : "must be an object",
        ),
    }),
    addSessionToReplayCart: fields({ fileKey: aString }),
    replaySessionNow: fields({ fileKey: aString }),
    removeFromReplayCart: fields({ snapshotId: aString }),
    reorderReplayCart: fields({ fromIndex: aNonNegativeInteger, toIndex: aNonNegativeInteger }),
    clearReplayCart: noArguments,
    reverseReplayCart: noArguments,
    setReplayCartOverride: fields({
        snapshotId: aString,
        override: nullOr(partialOverridesShape),
    }),
    setReplayCartConfigMode: fields({
        snapshotId: aString,
        configMode: oneOf(replayCartConfigModes),
    }),
    queueReplayCart: fields({ configMode: optional(oneOf(replayCartConfigModes)) }),
    runReplayMatrix: fields({
        profileIds: arrayOf(oneOf(inlineCompletionDebugProfileIds)),
        schemaBudgetProfileIds: arrayOf(oneOf(inlineCompletionSchemaBudgetProfileIds)),
    }),
    cancelReplayRun: fields({ runId: optional(aString) }),
    copyEventPayload: fields({ eventId: aString, kind: oneOf(copyEventPayloadKinds) }),
};

/** Every command name in the protocol (derived from the validator table). */
export const icDebugCommandNames = Object.keys(commandPayloadChecks) as Array<
    keyof InlineCompletionDebugReducers
>;

export function isIcDebugCommandName(name: string): name is keyof InlineCompletionDebugReducers {
    return Object.prototype.hasOwnProperty.call(commandPayloadChecks, name);
}

/**
 * Validate an untrusted command envelope. ok:false results carry an
 * actionable message and MUST short-circuit before any service dispatch.
 */
export function validateIcDebugCommand(value: unknown): IcDebugCommandValidation {
    if (!isJsonRecord(value)) {
        return { ok: false, message: "command must be an object with name and payload" };
    }
    const name = value.name;
    if (typeof name !== "string" || !isIcDebugCommandName(name)) {
        return { ok: false, message: `unknown command name: ${JSON.stringify(name)}` };
    }
    const payload = value.payload === undefined ? {} : value.payload;
    if (!isJsonRecord(payload)) {
        return { ok: false, message: `${name}: payload must be an object` };
    }
    const problem = commandPayloadChecks[name](payload);
    if (problem) {
        return { ok: false, message: `${name}: ${problem}` };
    }
    return { ok: true, command: { name, payload } as IcDebugCommand };
}
