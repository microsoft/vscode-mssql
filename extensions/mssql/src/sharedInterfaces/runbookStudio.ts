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
import type {
    DerivedSourceAuthoringEdit,
    OutputPresentationSummary,
    OutputSchemaDescriptor,
    OutputViewSettings,
    PresentationLayoutEdit,
    PresentationLayoutPolicyEdit,
    PresentationLayoutStrategy,
    PresentationMode,
    PresentationWidgetSummary,
    ResolvedPresentation,
    ViewKind,
} from "./runbookPresentation";

// ---------------------------------------------------------------------------
// Version domains
// ---------------------------------------------------------------------------

export const RUNBOOK_SOURCE_SCHEMA_VERSION = 1;
export const RUNBOOK_LOCK_SCHEMA_VERSION = 1;
export const RUNBOOK_REQUIREMENTS_SCHEMA_VERSION = 1;
export const RUNBOOK_DESIGN_SCHEMA_VERSION = 1;
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
    | "RunbookStudio.CompileInvalid"
    | "RunbookStudio.TargetChanged"
    | "RunbookStudio.ApprovalInvalid"
    | "RunbookStudio.ApprovalPersistenceFailed"
    | "RunbookStudio.EffectRecoveryRequired"
    | "RunbookStudio.DeploymentPreviewChanged"
    | "RunbookStudio.DeploymentFailed"
    | "RunbookStudio.SchemaDriftDetected"
    | "RunbookStudio.SqlTestContractInvalid"
    | "RunbookStudio.SqlTestsFailed"
    | "RunbookStudio.Cancelled"
    | "RunbookStudio.Interrupted"
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

export type RunbookFamily = "build" | "validate" | "investigate" | "composed";

/** Closed target taxonomy for preflight and policy. A target is explicit;
 *  non-SQL work must never inherit an ambient active connection. */
export type RunbookTargetKind =
    | "workspace"
    | "databaseProject"
    | "dacpac"
    | "sqlDatabase"
    | "ephemeralSqlDatabase"
    | "ciAgent";

export interface RunbookTargetRequirement {
    kind: RunbookTargetKind;
    environment: BlastRadius["targetEnvironment"];
}

export interface RunbookActivityRequirement {
    /** Registered activity kind and minimum compatible version. */
    kind: string;
    version: number;
    host: "extension" | "hobbes" | "headless";
    /** Minimum host release needed by this activity contract. */
    minimumHostVersion?: string;
    /** Planning may use a model; execution requirements must be explicit. */
    providerRequirement?: "none" | "planning" | "execution";
    effect: "read" | "mutate";
    approvalRequired: boolean;
    connectionRequirement: "none" | "required" | "provisioned";
    secretRequirement: "none" | "requiredAtRunTime";
    rollbackContract: "none" | "automatic" | "required";
    outputContract: string;
}

/** Deterministic requirements carried with authored source and checked
 *  before model-expensive planning and again at run admission. */
export interface RunbookCapabilityManifest {
    schemaVersion: typeof RUNBOOK_REQUIREMENTS_SCHEMA_VERSION;
    targets: RunbookTargetRequirement[];
    activities: RunbookActivityRequirement[];
}

/** Reviewable, explicitly non-executable workflow produced when required
 * activities are unavailable. It contains no activity inputs or bindings and
 * can never be admitted as a compiled lock. */
export interface RunbookDesignStep {
    id: string;
    label: string;
    description: string;
    activityKind: string;
    activityVersion: number;
    targetKind: RunbookTargetKind;
    dependsOn: string[];
}

export interface RunbookDesignPlan {
    schemaVersion: typeof RUNBOOK_DESIGN_SCHEMA_VERSION;
    family: RunbookFamily;
    steps: RunbookDesignStep[];
}

export interface RunbookSource {
    schemaVersion: typeof RUNBOOK_SOURCE_SCHEMA_VERSION;
    /** The authored natural-language intent. */
    intent: string;
    parameters: RunbookParameterDefinition[];
    requirements?: RunbookCapabilityManifest;
    /** Present only for an explicitly non-executable design-only workflow. */
    design?: RunbookDesignPlan;
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

/** A locked activity target is data, never ambient editor state. Parameter
 * bindings are resolved at admission; node outputs are resolved only after
 * the producing node succeeds; workspace bindings remain portable across
 * machines by naming an optional workspace-relative folder. */
export type RunbookTargetBinding =
    | { source: "parameter"; parameterId: string }
    | { source: "nodeOutput"; nodeId: string; output: string }
    | { source: "workspace"; workspaceFolder?: string };

export interface RunbookPlanTarget {
    kind: RunbookTargetKind;
    binding: RunbookTargetBinding;
}

/** Bounded presentation projection of control-flow semantics owned by a
 * Hobbes runtime-library plan. The runtime asset remains authoritative for
 * execution; this metadata lets the native editor explain the plan without
 * retaining arbitrary runtime JSON or translating it back for launch. */
export interface RunbookRuntimePlanSemantics {
    nodeType: string;
    role?: string;
    description?: string;
    decision?: {
        branches: Array<{
            branchKey?: string;
            label: string;
            targetNodeIds: string[];
            expression?: string;
        }>;
        defaultTargetNodeId?: string;
    };
    parallel?: {
        branchNodeIds: string[];
        fanInTargetNodeId?: string;
    };
    approval?: {
        reason: string;
        approvalKind: string;
        onApprove: string;
        onReject?: string;
    };
}

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
    /** Explicit typed resource affected/read by this activity. Activities
     * that need a target are refused at admission when this is absent. */
    target?: RunbookPlanTarget;
    /** Contract is executable only in the deterministic fake runtime. */
    previewOnly?: boolean;
    blastRadius?: BlastRadius;
    /** Native-display projection of a runtime-authored node. This is not an
     * extension execution contract; libraryAssetRef remains the authority. */
    runtime?: RunbookRuntimePlanSemantics;
}

export interface RunbookPlanEdge {
    from: string;
    to: string;
    /** Runtime-authored route label. It is descriptive unless `when` also
     * carries one of the extension's closed executable conditions. */
    label?: string;
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
    /** Plan authored by the runtime planner: the hobbes lane launches this
     *  library asset directly and never translates the lock. */
    libraryAssetRef?: { assetId: string; versionLabel?: string };
}

export interface RunbookArtifactFile {
    /** Artifact envelope version (source/lock carry their own versions). */
    schemaVersion: 1;
    /** Stable runbook identity (survives rename of the file). */
    id: string;
    name: string;
    description?: string;
    family?: RunbookFamily;
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
    /** Stable activity output slot. Older run records omit this; their first
     * output is treated as the conventional `primary` slot. */
    slot?: string;
    /** Data contract id, e.g. "rowset/1", "log/1", "scalarSet/1". */
    contract: string;
    rows?: number;
    bytes?: number;
    /** Evicted per retention policy: still listed, renders as expired. */
    expired?: boolean;
    /** Payload exceeded the per-payload byte cap; the retained detail is a
     *  bounded prefix (honest truncation — never silently complete). */
    truncated?: boolean;
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
    /** Structured reason for a skipped node whose conditional branch was not
     * selected. Presentation resolution uses this instead of localized text
     * to reflow absent branch outputs. */
    branchNotTaken?: boolean;
    outputs?: DataHandleRef[];
    /** Runtime-observed query text retained behind an opaque result handle.
     *  Kept separate from authored inputs and presentation output slots so
     *  drill-in never implies that the planned text was actually executed. */
    executedQuery?: DataHandleRef;
}

export interface RunbookPendingGate {
    nodeId: string;
    gateKind: "approval";
    /** Localized description of the exact pending effect. */
    impactSummary: string;
}

/** Durable totals for user-visible run diagnostics. Absence means the
 * runtime did not measure diagnostics; a present zero is an observed zero. */
export interface RunbookDiagnosticCounts {
    warningCount: number;
    errorCount: number;
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
    /** Bounded, runtime-published scalar metrics. Keys and values are copied
     * into the durable terminal record; presentation never evaluates an
     * expression to obtain them. */
    runMetrics?: Record<string, string | number | boolean>;
    /** Runtime-owned measured diagnostics. Kept separate from verdicts and
     * failed assertions so Results never invents a diagnostic count. */
    diagnosticCounts?: RunbookDiagnosticCounts;
    error?: RbsError;
}

/** Plan identity carried on the run.accepted event so a journal is
 *  self-sufficient for recovery: an interrupted run can be attributed to its
 *  runbook, plan, and node list from the ledger file alone after restart. */
export interface RunbookRunAcceptedMeta {
    runbookId: string;
    planRevision: string;
    planHash: string;
    nodeIds: string[];
    /** Extension-host pid that owns the live run. Storage is shared across
     *  windows; rehydration must never seal another live window's run. */
    pid?: number;
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
    /** node.state only; persisted so branch-aware layouts survive restart. */
    branchNotTaken?: boolean;
    outputs?: DataHandleRef[];
    /** node.state only; latest runtime-observed query detail for this node. */
    executedQuery?: DataHandleRef;
    gate?: RunbookPendingGate;
    error?: RbsError;
    /** run.terminal only; bounded scalar metrics published by the runtime. */
    runMetrics?: Record<string, string | number | boolean>;
    /** run.terminal only; bounded measured warning/error totals. */
    diagnosticCounts?: RunbookDiagnosticCounts;
    /** run.accepted only: plan identity for journal-only recovery. */
    accepted?: RunbookRunAcceptedMeta;
    /** Terminal was written DURING rehydration (the run was interrupted by
     *  a window close), not observed from the runtime. Honest provenance. */
    synthesized?: boolean;
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

export type RbsRoute =
    | "author"
    | "parameters"
    | "run"
    | "plan"
    | "preview"
    | "results"
    | "history"
    | "debug";

/** Bounded artifact projection for rendering (never the raw file text). */
export interface RbsArtifactSummary {
    id: string;
    name: string;
    description?: string;
    family?: string;
    intent: string;
    parameters: RunbookParameterDefinition[];
    requirements?: RunbookCapabilityManifest;
    design?: RunbookDesignPlan;
    readiness?: RbsRunbookReadiness;
    hasLock: boolean;
    planRevision?: string;
    entryNodeId?: string;
    nodes: RunbookPlanNode[];
    edges: RunbookPlanEdge[];
    /** User-pinned output views by node id (presentation definition pins). */
    pinnedViews?: Record<string, ViewKind>;
    /** V2 multi-view authoring projection by primary-output node id. */
    outputPresentations?: Record<string, OutputPresentationSummary>;
    /** Catalog-owned field descriptors by plan node. Missing entries mean
     * the shape is known only after execution. */
    outputSchemas?: Record<string, OutputSchemaDescriptor>;
    presentationRevision?: number;
    presentationLayoutStrategy?: PresentationLayoutStrategy;
    presentationSections?: Array<{
        id: string;
        label?: string;
        role: string;
        order: number;
    }>;
    /** Source-aware persisted widget projection, including hidden run-field,
     * run-metric, and derived widgets. */
    presentationWidgets?: PresentationWidgetSummary[];
    derivedSources?: DerivedSourceAuthoringEdit[];
}

export interface RbsRunbookReadiness {
    status: "ready" | "readyAfterBinding" | "designOnly" | "policyBlocked" | "incompatible";
    missingActivityKinds: string[];
    issues?: RbsReadinessIssue[];
}

export interface RbsReadinessIssue {
    dimension:
        | "activity"
        | "host"
        | "provider"
        | "policy"
        | "target"
        | "binding"
        | "approval"
        | "rollback"
        | "output";
    code: string;
    message: string;
    activityKind?: string;
}

/** One selectable run for the History/Results run picker (persisted runs
 *  survive restart; selecting one re-resolves its presentation). */
export interface RbsAvailableRun {
    runId: string;
    startedEpochMs?: number;
    state: RunbookRunStateKind;
    verdict?: "pass" | "fail" | "indeterminate";
}

export interface RbsState {
    schemaVersion: typeof RBS_STATE_SCHEMA_VERSION;
    documentKind: "saved" | "untitled";
    fileName: string;
    workspaceTrusted: boolean;
    artifact?: RbsArtifactSummary;
    /** Set when the backing document does not parse/validate. */
    artifactError?: RbsError;
    /** The run being presented: the user-selected run when one is selected
     *  (rbs/selectRun), else the active/most recent run for this document. */
    run?: RunbookRunSnapshot;
    /** runId of the run `run`/`presentation` reflect (picker highlight). */
    selectedRunId?: string;
    /** Prior runs (from the durable ledger) selectable in the picker,
     *  newest first. Present when at least one run is known. */
    availableRuns?: RbsAvailableRun[];
    /** Deterministic resolved results layout for the active run (handles
     *  only — the webview pulls pages through the controller). */
    presentation?: ResolvedPresentation;
    /** Session-only layout overlay for one run. It survives page navigation
     * and state pushes but is never written into the runbook artifact. */
    presentationOverlay?: {
        runId: string;
        edits: PresentationLayoutEdit[];
        policy?: PresentationLayoutPolicyEdit;
    };
    /** Pre-run presentation resolved against bounded synthetic handles. */
    previewPresentation?: ResolvedPresentation;
    /** Branch-aware pre-run lenses. Every presentation is resolved with the
     * same saved definition and a different effect-free synthetic snapshot. */
    previewScenarios?: Array<{
        id: "clean" | "blockingErrors" | "approvalRejected";
        presentation: ResolvedPresentation;
        hiddenBranchWidgetCount: number;
        hiddenBranchNodeIds: string[];
    }>;
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

/**
 * One typed planner event streamed while the runtime planner compiles an
 * intent (display only — never persisted). Kinds:
 *  - "turn-started":    a planner build turn began (seq, label, turnKind).
 *  - "turn-completed":  that turn finished (durationMs; text carries the
 *                       turn's summary prose, truncated at the source).
 *  - "reasoning":       a coalesced run of live model reasoning deltas (text).
 *  - "tool-call":       the planner invoked a tool (toolName; text is the
 *                       runtime's one-line call description).
 *  - "inputs-proposed": the proposed input schema (text = comma-joined names).
 *  - "phase":           coarse one-liner phases (session started, plan
 *                       synthesized, dry-run passed) — localized at source.
 *  - "model":           the model id resolved for the planner role (text =
 *                       the model id; label = the provider label).
 */
export interface RbsPlannerProgressEvent {
    kind:
        | "turn-started"
        | "turn-completed"
        | "reasoning"
        | "tool-call"
        | "inputs-proposed"
        | "phase"
        | "model";
    /** Planner turn sequence number (turn events). */
    seq?: number;
    /** Turn label, e.g. "Gather — Confirm sustained CPU pressure" (turn
     *  events); the provider label ("model"). */
    label?: string;
    /** Turn kind, e.g. "workflow-shape" | "gather-detail" (turn events). */
    turnKind?: string;
    /** Turn duration in milliseconds (turn-completed only). */
    durationMs?: number;
    /** Event text payload (see kind docs above). */
    text?: string;
    /** Invoked tool name (tool-call only). */
    toolName?: string;
}

/** Compile-phase progress stream (runtime planner console) — display only. */
export namespace RbsCompileProgressNotification {
    export const type = new NotificationType<RbsPlannerProgressEvent>("rbs/compileProgress");
}

/** Abort an in-flight plan generation (the Author page's Cancel). */
export namespace RbsCancelCompileRequest {
    export const type = new RequestType<Record<string, never>, { cancelled: boolean }, void>(
        "rbs/cancelCompile",
    );
}

/** Pin (or clear) the output view for a plan node — writes a pinned widget
 *  into the artifact's presentation definition (mockup "Set by you"). */
export namespace RbsSetOutputViewRequest {
    export const type = new RequestType<
        { nodeId: string; view: ViewKind | undefined },
        { applied: boolean },
        void
    >("rbs/setOutputView");
}

/** Replace the V2 presentation for a node's primary output. The base
 * revision makes concurrent/stale authoring explicit instead of clobbering. */
export namespace RbsSetOutputPresentationRequest {
    export const type = new RequestType<
        {
            nodeId: string;
            views: ViewKind[];
            presentation: PresentationMode;
            defaultView: ViewKind;
            settings?: OutputViewSettings;
            baseRevision: number;
            resetToSuggested?: boolean;
        },
        { applied: boolean; reason?: "invalid" | "revisionConflict" },
        void
    >("rbs/setOutputPresentation");
}

export namespace RbsApplyPresentationLayoutRequest {
    export const type = new RequestType<
        {
            edits: PresentationLayoutEdit[];
            policy?: PresentationLayoutPolicyEdit;
            baseRevision: number;
        },
        { applied: boolean; reason?: "invalid" | "revisionConflict" | "cancelled" },
        void
    >("rbs/applyPresentationLayout");
}

/** Resolve a staged layout batch without persisting it. The host uses the
 * same validator and resolver as the eventual runbook edit, and synthetic
 * targets remain effect-free. */
export namespace RbsPreviewPresentationLayoutRequest {
    export const type = new RequestType<
        {
            edits: PresentationLayoutEdit[];
            policy?: PresentationLayoutPolicyEdit;
            baseRevision: number;
            target:
                | { kind: "run"; runId: string }
                | {
                      kind: "sample";
                      scenario: "clean" | "blockingErrors" | "approvalRejected";
                  };
        },
        {
            presentation?: ResolvedPresentation;
            reason?: "invalid" | "revisionConflict" | "targetMissing";
        },
        void
    >("rbs/previewPresentationLayout");
}

export namespace RbsApplyPresentationOverlayRequest {
    export const type = new RequestType<
        {
            runId: string;
            edits: PresentationLayoutEdit[];
            policy?: PresentationLayoutPolicyEdit;
            baseRevision: number;
        },
        { applied: boolean; reason?: "invalid" | "revisionConflict" | "targetMissing" },
        void
    >("rbs/applyPresentationOverlay");
}

export namespace RbsClearPresentationOverlayRequest {
    export const type = new RequestType<{ runId: string }, { cleared: boolean }, void>(
        "rbs/clearPresentationOverlay",
    );
}

/** Open a compiled read-query step in Query Studio and execute it against
 *  the explicitly bound saved connection. Executable SQL never crosses
 *  from the webview; the extension host resolves it again by node id. */
export namespace RbsExecutePlanQueryRequest {
    export const type = new RequestType<
        { nodeId: string; connectionValues: Record<string, string> },
        { opened: boolean; error?: RbsError },
        void
    >("rbs/executePlanQuery");
}

/** Compile the intent into a plan (model-backed; catalog-constrained). */
export namespace RbsCompileRequest {
    export const type = new RequestType<
        { intent: string },
        { ok: boolean; error?: RbsError },
        void
    >("rbs/compile");
}

export interface RbsConnectionProfileRef {
    id: string;
    label: string;
}

export type RbsModelRole = "authoring" | "execution";

/** One model the selected Hobbes provider reports as executable. */
export interface RbsModelOption {
    id: string;
    name: string;
    vendor: string;
    isDefault: boolean;
}

/** Role-specific runtime default. Authoring and execution may intentionally
 * use different provider profiles, so each projection carries its provider. */
export interface RbsModelRoleConfiguration {
    providerId: string;
    providerKind: string;
    providerLabel: string;
    modelId: string;
    models: RbsModelOption[];
}

export interface RbsModelConfiguration {
    authoring: RbsModelRoleConfiguration;
    execution: RbsModelRoleConfiguration;
}

export namespace RbsGetModelConfigurationRequest {
    export const type = new RequestType<
        Record<string, never>,
        { configuration?: RbsModelConfiguration; error?: RbsError },
        void
    >("rbs/getModelConfiguration");
}

export namespace RbsSetModelConfigurationRequest {
    export const type = new RequestType<
        { role: RbsModelRole; modelId: string },
        { applied: boolean; configuration?: RbsModelConfiguration; error?: RbsError },
        void
    >("rbs/setModelConfiguration");
}

/** Saved connections as opaque handles for connection-typed parameters. */
export namespace RbsListConnectionsRequest {
    export const type = new RequestType<void, { profiles: RbsConnectionProfileRef[] }, void>(
        "rbs/listConnections",
    );
}

export namespace RbsStartRunRequest {
    export const type = new RequestType<
        {
            parameterValues: Record<string, string | number | boolean | null>;
            /** Explicit, run-scoped approval mode; never persisted. */
            autoApprove?: boolean;
        },
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
        {
            runId: string;
            nodeId: string;
            approve: boolean;
            /** Approve this gate and every later gate in this run only. */
            approveAll?: boolean;
        },
        { accepted: boolean; error?: RbsError },
        void
    >("rbs/respondToGate");
}

export namespace RbsOpenRunDropRequest {
    export const type = new RequestType<
        { runId: string },
        { opened: boolean; error?: RbsError },
        void
    >("rbs/openRunDrop");
}

export namespace RbsDeleteRunRequest {
    export const type = new RequestType<
        { runId: string },
        { deleted: boolean; error?: RbsError },
        void
    >("rbs/deleteRun");
}

export namespace RbsGetRunRequest {
    export const type = new RequestType<{ runId: string }, RunbookRunSnapshot | undefined, void>(
        "rbs/getRun",
    );
}

/** Select which run the state's `run`/`presentation` reflect. The snapshot
 *  is resolved from the durable ledger (works across restarts); ok:false
 *  when the run is unknown or its record is unreadable. Selecting the
 *  currently active run returns the view to live-follow mode. */
export namespace RbsSelectRunRequest {
    export const type = new RequestType<{ runId: string }, { ok: boolean }, void>("rbs/selectRun");
}

/** Bounded page pull for a data handle (rows never ride notifications). */
export namespace RbsFetchOutputPageRequest {
    export const type = new RequestType<
        {
            handleId: string;
            derivedSourceId?: string;
            derivedPreviewId?: string;
            startRow: number;
            rowCount: number;
        },
        {
            columns?: string[];
            rows?: Array<Array<string | number | boolean | null>>;
            totalRows?: number;
            /** The stored payload was truncated at the byte cap; totalRows
             *  counts the RETAINED rows only (honest partial data). */
            truncated?: boolean;
            error?: RbsError;
        },
        void
    >("rbs/fetchOutputPage");
}

/** CI-friendly projections of the host-retained evidence manifest. The
 * webview sends only a run identity and format; evidence content and the
 * destination URI stay in the trusted extension host. */
export type RbsEvidenceExportFormat = "json" | "junit" | "sarif" | "markdown";

export namespace RbsExportEvidenceRequest {
    export const type = new RequestType<
        { runId: string; format: RbsEvidenceExportFormat },
        { exported: boolean; cancelled?: boolean; error?: RbsError },
        void
    >("rbs/exportEvidence");
}

/** Native actions over a typed retained file artifact. The webview supplies
 * only the opaque output handle; source and destination paths stay in the
 * trusted extension host. Omitting `action` performs an availability probe. */
export type RbsOutputArtifactAction = "open" | "reveal" | "exportCopy";

export namespace RbsOutputArtifactRequest {
    export const type = new RequestType<
        { handleId: string; action?: RbsOutputArtifactAction },
        {
            available: boolean;
            fileName?: string;
            performed?: boolean;
            cancelled?: boolean;
            error?: RbsError;
        },
        void
    >("rbs/outputArtifact");
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
