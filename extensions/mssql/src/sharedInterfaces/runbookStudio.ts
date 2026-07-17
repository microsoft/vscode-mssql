/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook Studio versioned contracts (Rbs*). The webview is a pure renderer:
 * coarse RbsState pushes + typed requests through the controller; result
 * payloads never ride state (data handles + paged fetches only). Version
 * domains are deliberately separate (ADR-2): artifact source, compiled lock,
 * run events, and webview state each evolve on their own number.
 */

import { NotificationType, RequestType } from "vscode-jsonrpc";

// ---------------------------------------------------------------------------
// Version domains
// ---------------------------------------------------------------------------

export const RUNBOOK_SOURCE_SCHEMA_VERSION = 1;
export const RUNBOOK_LOCK_SCHEMA_VERSION = 1;
export const RBS_STATE_SCHEMA_VERSION = 1;
export const RUNBOOK_RUN_EVENT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Stable error identities (A2 §6.5). The user-facing message may be localized
// prose; diagnostics and RPC errors carry ONLY the code plus safe structure.
// ---------------------------------------------------------------------------

export type RunbookStudioErrorCode =
    | "RunbookStudio.InvalidArtifact"
    | "RunbookStudio.IncompatibleVersion"
    | "RunbookStudio.RuntimeUnavailable"
    | "RunbookStudio.RuntimeCapabilityUnsupported"
    | "RunbookStudio.RuntimeProtocol"
    | "RunbookStudio.RuntimeExited"
    | "RunbookStudio.ActivityUnsupported"
    | "RunbookStudio.ActivityPolicyDenied"
    | "RunbookStudio.ActivityFailed"
    | "RunbookStudio.ModelUnavailable"
    | "RunbookStudio.ModelCapabilityUnsupported"
    | "RunbookStudio.ModelDenied"
    | "RunbookStudio.BindingInvalid"
    | "RunbookStudio.RunActive"
    | "RunbookStudio.TargetChanged"
    | "RunbookStudio.ApprovalInvalid"
    | "RunbookStudio.Cancelled"
    | "RunbookStudio.Timeout"
    | "RunbookStudio.ReplayRefused"
    | "RunbookStudio.DataUnavailable"
    | "RunbookStudio.PresentationInvalid"
    | "RunbookStudio.PresentationConflict"
    | "RunbookStudio.WorkspaceUntrusted"
    | "RunbookStudio.Internal";

export interface RbsError {
    code: RunbookStudioErrorCode;
    /** Localized, safe explanation for the user. Never raw provider text. */
    message: string;
    retryable?: boolean;
}

// ---------------------------------------------------------------------------
// Repository artifact (ADR-4): one `.runbook.json` file with separated
// source / lock / presentation sections. Run records NEVER live here.
// ---------------------------------------------------------------------------

export type RunbookParameterType =
    | "string"
    | "int"
    | "boolean"
    | "enum"
    | "connection"
    | "database"
    | "secret";

export interface RunbookParameterDefinition {
    /** Stable id; survives reformatting and label edits. */
    id: string;
    label: string;
    type: RunbookParameterType;
    description?: string;
    required?: boolean;
    /** Never present for type "secret" (secrets are rebind-only). */
    default?: string | number | boolean;
    enumValues?: string[];
}

export interface RunbookSource {
    schemaVersion: typeof RUNBOOK_SOURCE_SCHEMA_VERSION;
    /** The authored natural-language intent. */
    intent: string;
    parameters: RunbookParameterDefinition[];
}

/** Safety taxonomy axes (ADR-6 / A1 §5.2). Closed enums — never free text. */
export interface BlastRadius {
    resource:
        | "none"
        | "workspaceFiles"
        | "databaseSchema"
        | "databaseData"
        | "process"
        | "container"
        | "network"
        | "externalService";
    operation: "read" | "create" | "modify" | "delete" | "execute" | "provision";
    targetEnvironment:
        | "local"
        | "ephemeral"
        | "ci"
        | "development"
        | "test"
        | "staging"
        | "approvedReadOnlyProduction";
    reversibility: "noEffect" | "autoReversible" | "manualReversible" | "irreversible";
    breadth?: "bounded" | "targetWide";
    dataSensitivity?: "public" | "internal" | "confidential" | "secretBearing";
}

export type RunbookPlanNodeKind = "activity" | "gate" | "report";

export interface RunbookPlanNode {
    /** Stable node id; referenced by edges, snapshots, and approvals. */
    id: string;
    label: string;
    kind: RunbookPlanNodeKind;
    /** Registered activity id, e.g. "sql.query.read" (kind === "activity"). */
    activityKind?: string;
    activityVersion?: number;
    /** Bind expressions / literal inputs, validated against the descriptor. */
    inputs?: Record<string, unknown>;
    blastRadius?: BlastRadius;
}

export interface RunbookPlanEdge {
    from: string;
    to: string;
    /** Edge condition; absent = unconditional success path. */
    when?: "success" | "failure" | "approved" | "rejected";
}

export interface CompiledRunbookLock {
    schemaVersion: typeof RUNBOOK_LOCK_SCHEMA_VERSION;
    /** Monotonic revision label of this compilation ("1", "2", ...). */
    planRevision: string;
    /** sha256 over the canonical source+plan; CI refuses on mismatch. */
    planHash: string;
    entryNodeId: string;
    nodes: RunbookPlanNode[];
    edges: RunbookPlanEdge[];
    activityCatalogFingerprint?: string;
}

export interface RunbookArtifactFile {
    /** Artifact envelope version (source/lock carry their own versions). */
    schemaVersion: 1;
    /** Stable runbook identity (survives rename of the file). */
    id: string;
    name: string;
    description?: string;
    family?: "build" | "validate" | "investigate";
    source: RunbookSource;
    lock?: CompiledRunbookLock;
    /** Versioned PresentationDefinition (rendering spec); opaque here. */
    presentation?: unknown;
}

// ---------------------------------------------------------------------------
// Run model (host-authoritative; runtime snapshots are inputs, never truth)
// ---------------------------------------------------------------------------

export type RunbookRunStateKind =
    | "accepted"
    | "running"
    | "awaitingApproval"
    | "cancelling"
    | "succeeded"
    | "failed"
    | "cancelled";

export type RunbookNodeStateKind =
    | "pending"
    | "queued"
    | "running"
    | "awaitingApproval"
    | "succeeded"
    | "failed"
    | "skipped"
    | "cancelled";

/** Reference to a typed output payload held by the result store. The payload
 *  itself never crosses into state — the webview pulls bounded pages. */
export interface DataHandleRef {
    handleId: string;
    /** Data contract id, e.g. "rowset/1", "log/1", "scalarSet/1". */
    contract: string;
    rows?: number;
    bytes?: number;
    /** Evicted per retention policy: still listed, renders as expired. */
    expired?: boolean;
}

export interface RunbookNodeSnapshot {
    nodeId: string;
    state: RunbookNodeStateKind;
    attempt: number;
    startedEpochMs?: number;
    durationMs?: number;
    /** Stable outcome enum for terminal states. */
    outcome?: "success" | "failure" | "cancelled" | "skipped" | "policyDenied";
    /** Localized, safe one-line result summary. */
    message?: string;
    outputs?: DataHandleRef[];
}

export interface RunbookPendingGate {
    nodeId: string;
    gateKind: "approval";
    /** Localized description of the exact pending effect. */
    impactSummary: string;
}

export interface RunbookRunSnapshot {
    runId: string;
    runbookId: string;
    planRevision: string;
    planHash: string;
    state: RunbookRunStateKind;
    /** Monotonic sequence of the last event folded into this snapshot. */
    seq: number;
    nodes: RunbookNodeSnapshot[];
    pendingGate?: RunbookPendingGate;
    startedEpochMs?: number;
    endedEpochMs?: number;
    verdict?: "pass" | "fail" | "indeterminate";
    error?: RbsError;
}

/** One run event (A2 §4.3): monotonic per-run sequence, versioned. */
export interface RunbookRunEvent {
    schemaVersion: typeof RUNBOOK_RUN_EVENT_SCHEMA_VERSION;
    runId: string;
    seq: number;
    type:
        | "run.accepted"
        | "run.state"
        | "node.state"
        | "node.progress"
        | "gate.requested"
        | "gate.responded"
        | "run.terminal";
    /** Display timestamp only — ordering is seq. */
    epochMs: number;
    nodeId?: string;
    attempt?: number;
    runState?: RunbookRunStateKind;
    nodeState?: RunbookNodeStateKind;
    outcome?: string;
    message?: string;
    outputs?: DataHandleRef[];
    gate?: RunbookPendingGate;
    error?: RbsError;
}

export interface RunbookRunHistoryEntry {
    runId: string;
    startedEpochMs: number;
    state: RunbookRunStateKind;
    planRevision: string;
    verdict?: "pass" | "fail" | "indeterminate";
}

// ---------------------------------------------------------------------------
// Webview state (coarse; pushed via StateChangeNotification)
// ---------------------------------------------------------------------------

export type RbsRoute = "author" | "parameters" | "run" | "plan" | "results" | "history" | "debug";

/** Bounded artifact projection for rendering (never the raw file text). */
export interface RbsArtifactSummary {
    id: string;
    name: string;
    description?: string;
    family?: string;
    intent: string;
    parameters: RunbookParameterDefinition[];
    hasLock: boolean;
    planRevision?: string;
    nodes: RunbookPlanNode[];
    edges: RunbookPlanEdge[];
}

export interface RbsState {
    schemaVersion: typeof RBS_STATE_SCHEMA_VERSION;
    documentKind: "saved" | "untitled";
    fileName: string;
    workspaceTrusted: boolean;
    artifact?: RbsArtifactSummary;
    /** Set when the backing document does not parse/validate. */
    artifactError?: RbsError;
    /** The active (latest) run for this document, if any. */
    run?: RunbookRunSnapshot;
    history: RunbookRunHistoryEntry[];
    /** Debug & Replay route visibility (developer/preview setting). */
    debugEnabled: boolean;
    /** One-shot initial route for deep links; consumed by the webview. */
    initialRoute?: RbsRoute;
}

// ---------------------------------------------------------------------------
// RPC: webview -> controller requests / controller -> webview notifications
// ---------------------------------------------------------------------------

export namespace RbsUpdateIntentRequest {
    export const type = new RequestType<{ intent: string }, { applied: boolean }, void>(
        "rbs/updateIntent",
    );
}

export namespace RbsStartRunRequest {
    export const type = new RequestType<
        { parameterValues: Record<string, string | number | boolean | null> },
        { runId?: string; error?: RbsError },
        void
    >("rbs/startRun");
}

export namespace RbsCancelRunRequest {
    export const type = new RequestType<
        { runId: string },
        { outcome: "cancelled" | "alreadyTerminal" | "failed" },
        void
    >("rbs/cancelRun");
}

export namespace RbsRespondToGateRequest {
    export const type = new RequestType<
        { runId: string; nodeId: string; approve: boolean },
        { accepted: boolean; error?: RbsError },
        void
    >("rbs/respondToGate");
}

export namespace RbsGetRunRequest {
    export const type = new RequestType<{ runId: string }, RunbookRunSnapshot | undefined, void>(
        "rbs/getRun",
    );
}

/** Bounded page pull for a data handle (rows never ride notifications). */
export namespace RbsFetchOutputPageRequest {
    export const type = new RequestType<
        { handleId: string; startRow: number; rowCount: number },
        {
            columns?: string[];
            rows?: Array<Array<string | number | boolean | null>>;
            totalRows?: number;
            error?: RbsError;
        },
        void
    >("rbs/fetchOutputPage");
}

/** Open the Debug Console trace for this run/operator (RBS2-7 deep link). */
export namespace RbsOpenDiagnosticsRequest {
    export const type = new RequestType<
        { runId?: string; nodeId?: string },
        { opened: boolean },
        void
    >("rbs/openDiagnostics");
}

export namespace RbsNavigateNotification {
    export const type = new NotificationType<{ route: RbsRoute }>("rbs/navigate");
}

/** Live run event fan-out (in addition to coarse state pushes). */
export namespace RbsRunEventNotification {
    export const type = new NotificationType<RunbookRunEvent>("rbs/runEvent");
}
