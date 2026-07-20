/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hobbes runtime adapter (RBS2-4b, ADR-1/ADR-3): drives the supplied
 * runtime's EXISTING deep-link launch surface — verified live against
 * runtime 0.1.0 and its source contracts:
 *
 *   POST /api/investigations/launch                {runbookId, runbookVersion?,
 *        connectionAlias, inputValues?, presetParams?}  -> {runId, confirmationCard}
 *   POST /api/investigations/runs/{runId}/confirm  -> 202 (execution begins)
 *   POST /api/investigations/runs/{runId}/cancel   {reason?}
 *   GET  /api/runs/{runId} -> {status: pending-confirmation|running|completed|
 *        failed|canceled, regionResults[{regionId,title,status,...}]}
 *
 * Observation is BOUNDARY-HONEST (A2 §11.1): run status + per-region results
 * come from polling the run record; region results map onto plan nodes only
 * where the artifact lock's node ids match the runtime's region ids. Gates
 * inside the runtime (its own approval middleware) are not yet surfaced over
 * this interface — capability reported false; richer AG-UI streaming is the
 * P2 follow-up and slots in behind this same adapter contract.
 */

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { RunbookStudio as LocRunbookStudio } from "../../constants/locConstants";
import { RbsPlannerProgressEvent, RunbookArtifactFile } from "../../sharedInterfaces/runbookStudio";
import {
    hasRuntimeLibraryAuthority,
    PlannedRunbook,
    PlannerPlanEdge,
    PlannerPlanNode,
    projectPlannerEdge,
    projectPlannerNode,
} from "../models/plannerMapping";
import {
    LibraryRunRef,
    parseLibraryDetailResponse,
    parseLibraryListResponse,
    RunbookLibraryAsset,
} from "../runbookLibraryModel";
import { emitRunbookEvent, metaField, RunbookOperationContext } from "../runbookDiag";
import {
    gateCorrelationKey,
    HobbesConnectionsFile,
    mergeConnectionEntry,
    translateArtifactToHobbesPlan,
} from "./hobbesPlanTranslator";
import { RuntimeSupervisor } from "./runtimeSupervisor";
import {
    RunbookRuntimeAdapter,
    RuntimeBoundaryEvent,
    RuntimeCapabilities,
    RuntimeEventObserver,
    RuntimeOutputPayload,
    RuntimeStartRefusedError,
    RuntimeStartRequest,
    RuntimeValidationIssue,
} from "./runtimeAdapterTypes";

const RUN_POLL_INTERVAL_MS = 750;
const REQUEST_TIMEOUT_MS = 15_000;
const HEALTH_PROBE_TIMEOUT_MS = 3_000;
/** A full planner elicitation session runs 1-5 minutes (verified live). */
const PLANNER_TIMEOUT_MS = 300_000;
const PROVIDER_LOGIN_TIMEOUT_MS = 300_000;

/** GET /api/runs/{runId} projection (InvestigationsLaunchApi.RunToJson). */
interface HobbesRunRecord {
    id: string;
    status: string;
    completedAt?: string | null;
    regionResults?: Array<{
        regionId: string;
        title?: string;
        status?: string;
        findingCount?: number;
        remediationCount?: number;
    }>;
}

/** One NDJSON line of a `/api/runbooks/from-prompt` planner session. Only
 *  the fields the bridge reads (wire shapes captured live). */
interface PlannerStreamEvent {
    type?: string;
    turnSeq?: number;
    turnLabel?: string;
    /** Turn taxonomy, e.g. "workflow-shape" | "gather-detail" (turn events). */
    turnKind?: string;
    /** Turn duration (build-turn-completed). */
    durationMs?: number;
    /** Turn summary prose — can be long (build-turn-completed). */
    response?: string;
    /** sql-expert-thinking taxonomy: "reasoning"|"tool-call"|"status"|"prompt". */
    kind?: string;
    /** sql-expert-thinking text delta (reasoning arrives as tiny fragments). */
    delta?: string;
    /** Invoked tool (sql-expert-thinking kind "tool-call"). */
    toolName?: string | null;
    /** Proposed inputs (planner-input-schema-proposed). */
    inputs?: Array<{ name?: string; kind?: string }>;
    /** Present on `error` events. */
    message?: string;
    /** Present on the terminal `runbook-asset` event. */
    asset?: PlannerAssetPayload;
}

export interface HobbesProviderStatus {
    loginRequired: boolean;
    provider: {
        profileId: string;
        kind: string;
        label: string;
        enabled: boolean;
        ready: boolean;
        reason?: string;
        supportsLogin: boolean;
    };
}

export interface HobbesProviderLoginEvent {
    kind: "deviceCode" | "pending" | "succeeded" | "failed" | "progress";
    verificationUri?: string;
    userCode?: string;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
    return typeof value === "string" && value.length > 0 && value.length <= maxLength
        ? value
        : undefined;
}

/** Strict projection of the runtime's safe auth-status document. */
export function parseHobbesProviderStatus(value: unknown): HobbesProviderStatus | undefined {
    const root = recordOf(value);
    const provider = recordOf(root?.provider);
    if (
        typeof root?.loginRequired !== "boolean" ||
        !provider ||
        typeof provider.enabled !== "boolean" ||
        typeof provider.ready !== "boolean" ||
        typeof provider.supportsLogin !== "boolean"
    ) {
        return undefined;
    }
    const profileId = boundedString(provider.profileId, 256);
    const kind = boundedString(provider.kind, 128);
    const label = boundedString(provider.label, 256);
    if (!profileId || !kind || !label) {
        return undefined;
    }
    const reason = boundedString(provider.reason, 500);
    return {
        loginRequired: root.loginRequired,
        provider: {
            profileId,
            kind,
            label,
            enabled: provider.enabled,
            ready: provider.ready,
            supportsLogin: provider.supportsLogin,
            ...(reason ? { reason } : {}),
        },
    };
}

/** Parse one SSE provider-login frame without trusting arbitrary event data. */
export function parseHobbesProviderLoginFrame(frame: string): HobbesProviderLoginEvent | undefined {
    let eventName = "progress";
    let data = "";
    for (const rawLine of frame.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
            data += line.slice(5).trim();
        }
    }
    let payload: Record<string, unknown> | undefined;
    try {
        payload = recordOf(data ? JSON.parse(data) : undefined);
    } catch {
        return undefined;
    }
    if (!payload) {
        return undefined;
    }
    const kind: HobbesProviderLoginEvent["kind"] =
        eventName === "device-code"
            ? "deviceCode"
            : eventName === "pending"
              ? "pending"
              : eventName === "succeeded"
                ? "succeeded"
                : eventName === "failed"
                  ? "failed"
                  : "progress";
    const verificationUri = boundedString(payload.verificationUri, 2_048);
    const userCode = boundedString(payload.userCode, 128);
    return {
        kind,
        ...(verificationUri ? { verificationUri } : {}),
        ...(userCode ? { userCode } : {}),
    };
}

/** Reasoning deltas over the flush ceiling emit as one run this size. */
const REASONING_FLUSH_CHARS = 240;
/** A partially filled buffer flushes once this old (checked as later
 *  stream events arrive — the NDJSON session streams continuously, so a
 *  timestamp check needs no timers). */
const REASONING_FLUSH_MS = 500;
/** Turn-completed summaries are truncated to this many chars for the UI. */
const TURN_SUMMARY_MAX_CHARS = 400;

/**
 * Pure reasoning-delta coalescer (exported for unit tests): the planner
 * streams hundreds of tiny `reasoning` deltas per turn; the UI wants a few
 * readable runs. Buffered text flushes as ONE emission when:
 *   - the buffer reaches REASONING_FLUSH_CHARS, or
 *   - a boundary arrives (tool-call/status delta, turn start/end, stream
 *     end) via flush(), or
 *   - poke(now) finds the first buffered char older than REASONING_FLUSH_MS.
 * Callers supply timestamps — no timers, fully deterministic under test.
 */
export class ReasoningCoalescer {
    private buffer = "";
    private firstBufferedAt: number | undefined;

    constructor(private readonly emit: (text: string) => void) {}

    /** Buffer one delta; flushes when the size ceiling is reached. */
    public append(delta: string, now: number): void {
        if (!delta) {
            return;
        }
        if (this.buffer.length === 0) {
            this.firstBufferedAt = now;
        }
        this.buffer += delta;
        if (this.buffer.length >= REASONING_FLUSH_CHARS) {
            this.flush();
        }
    }

    /** Deadline check — call as any later stream event passes by. */
    public poke(now: number): void {
        if (
            this.firstBufferedAt !== undefined &&
            now - this.firstBufferedAt >= REASONING_FLUSH_MS
        ) {
            this.flush();
        }
    }

    /** Boundary flush: emits the buffered run, if any. */
    public flush(): void {
        if (this.buffer.length === 0) {
            this.firstBufferedAt = undefined;
            return;
        }
        const text = this.buffer;
        this.buffer = "";
        this.firstBufferedAt = undefined;
        this.emit(text);
    }
}

/** Wire body for planner generation. A target makes generation replace one
 *  existing draft under optimistic concurrency instead of minting a second
 *  library asset. Exported so the identity contract stays unit-testable
 *  without opening a streaming HTTP session. */
export function plannerRequestBody(
    promptText: string,
    target?: { assetId: string; revisionId: string },
): { promptText: string; runbookId?: string; ifMatchRevision?: string } {
    return {
        promptText,
        ...(target ? { runbookId: target.assetId, ifMatchRevision: target.revisionId } : {}),
    };
}

/** The slice of the saved library asset the planner bridge maps. */
interface PlannerAssetPayload {
    id?: string;
    revisionId?: string;
    title?: string;
    plan?: {
        entryNodeId?: string;
        nodes?: unknown[];
        edges?: unknown[];
    };
    inputSchema?: Array<{ name?: string; kind?: string }>;
}

export interface LibraryDocumentBaseline {
    assetId: string;
    revisionId: string;
    /** Hash of authoring content only. Lifecycle-only revision changes
     *  (approve/run) do not produce false edit conflicts. */
    contentFingerprint: string;
    /** Namespaced extension projection. This is the concurrency identity for
     *  native plans, whose executable plan can change independently and is
     *  safely preserved during a VS Code save. */
    extensionFingerprint: string;
    /** Exact extension-owned projection at read time. Kept only in memory so
     *  a later conflict can apply the local delta to the newer projection. */
    extensionArtifact?: unknown;
}

export type LibraryDocumentCommitResult =
    | {
          status: "committed";
          baseline: LibraryDocumentBaseline;
          versionLabel?: string;
      }
    | {
          status: "conflict";
          baseline: LibraryDocumentBaseline;
          /** A common extension projection exists for a three-way rebase. */
          canRebase: boolean;
      };

export type LibraryDocumentConflictResolution = "normal" | "rebase" | "overwrite";

/** Authoring fields whose change represents a real concurrent edit. Runtime
 *  lifecycle fields (revision/state/version/timestamps/validation cache) are
 *  deliberately excluded so running or approving a runbook does not make a
 *  subsequent document save conflict. */
const LIBRARY_AUTHORING_FIELDS = [
    "title",
    "description",
    "category",
    "regions",
    "inputSchema",
    "inputReferenceBindings",
    "plan",
    "sourcePromptText",
    "tags",
    "sourceAgentId",
    "capabilityFingerprint",
    "allowedPresetParams",
    "estimatedCost",
    "parameters",
    "lowGrounding",
    "clientExtensions",
    "schemaVersion",
] as const;

const LIBRARY_EXTENSION_FIELDS = ["clientExtensions"] as const;

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(stableValue);
    }
    if (isRecordValue(value)) {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, stableValue(value[key])]),
        );
    }
    return value;
}

const missingJsonValue = Symbol("missingJsonValue");
type MaybeJsonValue = unknown | typeof missingJsonValue;

function stableJsonEqual(left: MaybeJsonValue, right: MaybeJsonValue): boolean {
    if (left === missingJsonValue || right === missingJsonValue) {
        return left === right;
    }
    return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

/** Three-way JSON merge used by library Rebase. Values changed only by the
 *  newer head are retained; values changed locally are replayed on top. Arrays
 *  and overlapping scalar edits are atomic and local-wins, matching a rebase
 *  of the editor's patch. */
function rebaseJsonValue(
    base: MaybeJsonValue,
    local: MaybeJsonValue,
    remote: MaybeJsonValue,
): MaybeJsonValue {
    if (stableJsonEqual(local, base)) {
        return remote;
    }
    if (stableJsonEqual(remote, base) || stableJsonEqual(local, remote)) {
        return local;
    }
    if (isRecordValue(base) && isRecordValue(local) && isRecordValue(remote)) {
        const merged: Record<string, unknown> = {};
        const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
        for (const key of keys) {
            const value = rebaseJsonValue(
                Object.hasOwn(base, key) ? base[key] : missingJsonValue,
                Object.hasOwn(local, key) ? local[key] : missingJsonValue,
                Object.hasOwn(remote, key) ? remote[key] : missingJsonValue,
            );
            if (value !== missingJsonValue) {
                merged[key] = value;
            }
        }
        return merged;
    }
    return local;
}

export function rebaseLibraryArtifact(
    base: unknown,
    local: RunbookArtifactFile,
    remote: unknown,
): RunbookArtifactFile {
    const merged = rebaseJsonValue(base, local, remote);
    return isRecordValue(merged) ? (merged as unknown as RunbookArtifactFile) : local;
}

/** Stable, privacy-safe content identity (hash only; never logged payload). */
export function libraryContentFingerprint(asset: Record<string, unknown>): string {
    return libraryFieldsFingerprint(asset, LIBRARY_AUTHORING_FIELDS);
}

function libraryFieldsFingerprint(
    asset: Record<string, unknown>,
    fields: readonly string[],
): string {
    const authoring = Object.fromEntries(
        fields
            .filter((field) => asset[field] !== undefined)
            .map((field) => [field, stableValue(asset[field])]),
    );
    return createHash("sha256").update(JSON.stringify(authoring)).digest("hex");
}

function libraryBaseline(assetId: string, asset: Record<string, unknown>): LibraryDocumentBaseline {
    const revisionId = asset.revisionId;
    if (typeof revisionId !== "string" || revisionId.length === 0) {
        throw new Error(`library asset '${assetId}' has no revision id`);
    }
    const clientExtensions = isRecordValue(asset.clientExtensions)
        ? asset.clientExtensions
        : undefined;
    const extensionArtifact = clientExtensions?.vscodeMssqlArtifact;
    return {
        assetId,
        revisionId,
        contentFingerprint: libraryContentFingerprint(asset),
        extensionFingerprint: libraryFieldsFingerprint(asset, LIBRARY_EXTENSION_FIELDS),
        ...(extensionArtifact !== undefined ? { extensionArtifact } : {}),
    };
}

interface ActivePoll {
    stop: boolean;
    /** Plan identity + shared observations from AG-UI and REST polling.
     *  Sharing one map lets terminal settlement distinguish executed nodes
     *  from genuinely unreached branch nodes without post-terminal events. */
    knownNodeIds: Set<string>;
    reportedNodeStates: Map<string, string>;
    /** Latest bounded finding/remediation totals reported per region. */
    regionMetrics: Map<string, { findingCount?: number; remediationCount?: number }>;
    /** Epoch of the first failed region report — arms the stall guard (the
     *  runtime can hang post-failure, e.g. on its summarize step: U-2). */
    failedNodeAt?: number;
    /** Observer for out-of-band emissions (gate responses). */
    observer?: RuntimeEventObserver;
    /** Gate node the run is currently suspended on (emitted once). */
    gateRequestedFor?: string;
    /** Gate node already answered — suppress re-emission while the
     *  runtime processes the resume turn. */
    gateRespondedFor?: string;
    /** Last investigation updatedAt observed — progress signal. */
    lastUpdatedAt?: string;
    /** Epoch when updatedAt last moved (arms the no-progress guard). */
    lastProgressEpoch?: number;
}

/** The slice of an investigation-snapshot envelope payload the bridge reads
 *  (full investigation clone; shapes captured live from runtime 0.1.0). */
export interface HobbesSnapshotPayload {
    informationSpace?: { nodes?: Array<{ id?: string; regionId?: string }> };
    widgets?: Record<string, HobbesSnapshotWidget | undefined>;
    runtime?: {
        /** Canonical report cache written before the execution-view projection. */
        workflowReports?: Record<string, { executedQueryText?: string | null } | undefined>;
        workflowExecutionView?: {
            regions?: Array<{
                id?: string;
                regionReport?: { executedQueryText?: string | null };
            }>;
        };
    };
    /** region-lifecycle payloads reuse this type; unrelated fields ignored. */
    phase?: string;
    status?: string;
}

export interface HobbesExecutedQuery {
    regionId: string;
    queryText: string;
}

/**
 * Project exact executed-query facts already published by Hobbes. Both the
 * canonical report cache and its typed execution-view projection are accepted
 * because snapshots can arrive between those two runtime updates. Unknown
 * regions and whitespace-only values are ignored; authored plan SQL is never a
 * fallback.
 */
export function executedQueriesFromSnapshot(
    payload: HobbesSnapshotPayload,
    knownNodeIds: ReadonlySet<string>,
): HobbesExecutedQuery[] {
    const byRegion = new Map<string, string>();
    const retain = (regionId: string | undefined, queryText: string | null | undefined) => {
        if (
            regionId &&
            knownNodeIds.has(regionId) &&
            typeof queryText === "string" &&
            queryText.trim().length > 0
        ) {
            byRegion.set(regionId, queryText);
        }
    };
    for (const [regionId, report] of Object.entries(payload.runtime?.workflowReports ?? {})) {
        retain(regionId, report?.executedQueryText);
    }
    for (const region of payload.runtime?.workflowExecutionView?.regions ?? []) {
        retain(region.id, region.regionReport?.executedQueryText);
    }
    return Array.from(byRegion, ([regionId, queryText]) => ({ regionId, queryText }));
}

export interface HobbesSnapshotWidget {
    id?: string;
    typeId?: string;
    nodeId?: string;
    title?: string;
    dataSource?: {
        type?: string;
        data?: {
            schema?: Array<{ name?: string }>;
            rows?: Array<Record<string, unknown>>;
            text?: string;
            summary?: string;
            headline?: string;
        };
    };
}

/**
 * Pure widget -> boundary output translation (exported for unit tests).
 * Unknown widget types return undefined — honest skip, never a fake render.
 */
export function translateWidgetToOutput(
    widget: HobbesSnapshotWidget,
): RuntimeOutputPayload | undefined {
    const data = widget.dataSource?.data;
    if (!data) {
        return undefined;
    }
    switch (widget.typeId) {
        // Chart-typed widgets carry the SAME schema+rows shape as tables
        // (verified live: line-chart with time-role column + measures) —
        // translate them all to rowset/1 so the extension's grid/bar/
        // timeseries renderers can chart the data.
        case "line-chart":
        case "bar-chart":
        case "pie-chart":
        case "data-grid":
        case "table": {
            const columns = (data.schema ?? [])
                .map((column) => column.name)
                .filter((name): name is string => typeof name === "string");
            if (columns.length === 0) {
                return undefined;
            }
            const rows = (data.rows ?? []).map((row) =>
                columns.map((column) => {
                    const cell = row[column];
                    return cell === null || cell === undefined
                        ? null
                        : typeof cell === "number" || typeof cell === "boolean"
                          ? cell
                          : String(cell);
                }),
            );
            return { contract: "rowset/1", columns, rows };
        }
        case "text":
            return typeof data.text === "string" && data.text.length > 0
                ? { contract: "markdown/1", text: data.text }
                : undefined;
        case "assessment-strip": {
            const summary = data.summary ?? data.headline;
            return typeof summary === "string" && summary.length > 0
                ? { contract: "markdown/1", text: summary }
                : undefined;
        }
        default:
            return undefined;
    }
}

/** After a region failure, give the runtime this long to finalize before
 *  the host declares the run failed (visible, never silent). */
const STALL_AFTER_FAILURE_MS = 60_000;

/** A running (not suspended) workflow whose investigation record shows no
 *  mutation for this long is declared failed. Generous because LLM-backed
 *  Aggregation/Recommendation steps legitimately think for minutes. */
const NO_PROGRESS_TIMEOUT_MS = 10 * 60_000;

/** Selected-profile projection the bridge writes into the runtime's
 *  JsonFile connection registry. Integrated auth only in this preview. */
export interface BridgeableConnectionProfile {
    label: string;
    server: string;
    database?: string;
    integratedAuth: boolean;
}

export class HobbesRuntimeAdapter implements RunbookRuntimeAdapter {
    private readonly polls = new Map<string, ActivePoll>();
    /** In-flight planner session abort (one planner session at a time). */
    private activePlannerAbort: AbortController | undefined;
    private plannerCancelRequested = false;

    constructor(
        private readonly supervisor: RuntimeSupervisor,
        /** Resolve a VS Code connection profile id to bridgeable metadata. */
        private readonly resolveProfile: (
            profileId: string,
        ) => Promise<BridgeableConnectionProfile | undefined> = () => Promise.resolve(undefined),
    ) {}

    // -- publish bridge ------------------------------------------------------

    /** Ensure the runtime uses its JsonFile connection registry and that the
     *  selected profile is registered; returns the launch alias. */
    private async ensureConnectionBridged(
        baseUrl: string,
        profileId: string,
        context: RunbookOperationContext,
    ): Promise<string> {
        const profile = await this.resolveProfile(profileId);
        if (!profile) {
            throw new RuntimeStartRefusedError(
                {
                    code: "RunbookStudio.BindingInvalid",
                    message: LocRunbookStudio.connectionProfileNotFound(profileId),
                },
                "connection-not-found",
            );
        }
        if (!profile.integratedAuth) {
            throw new RuntimeStartRefusedError(
                {
                    code: "RunbookStudio.BindingInvalid",
                    message: LocRunbookStudio.hobbesIntegratedAuthOnly,
                },
                "connection-auth-unsupported",
            );
        }
        // ORDER MATTERS (verified live: fresh setups 400'd with
        // connection-not-found): launch-side alias resolution caches the
        // registry AT RUNTIME STARTUP, so the connections file must be on
        // disk BEFORE any restart, and adding a NEW alias to an already-
        // jsonfile runtime also requires a restart to refresh that cache.
        const alias = profile.label.replace(/[^A-Za-z0-9 _.-]/g, "_");
        const filePath = path.join(this.supervisor.dataDir, "sql-connections.json");
        let existing: Partial<HobbesConnectionsFile> | undefined;
        try {
            existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch {
            existing = undefined;
        }
        const merged = mergeConnectionEntry(existing, {
            name: alias,
            server: profile.server,
            ...(profile.database ? { database: profile.database } : {}),
        });
        const nextContent = JSON.stringify(merged, undefined, 2);
        const fileChanged = nextContent !== JSON.stringify(existing ?? {}, undefined, 2);
        if (fileChanged) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, nextContent);
        }

        const settings = (await (
            await this.request(baseUrl, "GET", "/runtime/settings")
        ).json()) as { sqlConnectionProvider?: string };
        const needsProviderSwitch = settings.sqlConnectionProvider !== "jsonfile";
        if (needsProviderSwitch) {
            await this.request(baseUrl, "PUT", "/runtime/settings", {
                sqlConnectionProvider: "jsonfile",
            });
            emitRunbookEvent(context, "runbookStudio.runtime.providerSwitched", "ok", {
                provider: metaField("jsonfile"),
            });
        }
        if (needsProviderSwitch || fileChanged) {
            await this.supervisor.restart(context);
        }
        return alias;
    }

    /** Translate + register the artifact in the runtime library (create or
     *  revert-to-draft -> update -> approve); returns the version label. */
    private async publishArtifact(
        artifact: RunbookArtifactFile,
        parameterValues: Record<string, string | number | boolean | null>,
        _context: RunbookOperationContext,
    ): Promise<string> {
        const runtime = await this.supervisor.ensureRunning(_context);
        // Publish happens per run, so substituting this run's parameter
        // values into thresholds is exact (not a cached approximation).
        const translation = translateArtifactToHobbesPlan(artifact, parameterValues);
        if (!translation.plan) {
            throw new RuntimeStartRefusedError(
                {
                    code: "RunbookStudio.RuntimeCapabilityUnsupported",
                    message: LocRunbookStudio.hobbesPublishRefused(translation.issues.join("; ")),
                },
                "publish-untranslatable",
            );
        }
        const base = runtime.baseUrl;
        let assetResponse = await this.request(
            base,
            "GET",
            `/api/runbooks/${encodeURIComponent(artifact.id)}`,
        );
        let asset: Record<string, unknown>;
        if (assetResponse.status === 404) {
            const created = await this.request(base, "POST", "/api/runbooks", {
                id: artifact.id,
                title: artifact.name,
                description: artifact.description ?? artifact.source.intent,
                category: artifact.family ?? "validate",
            });
            if (!created.ok) {
                throw launchRefusalError(`publish-create-http-${created.status}`);
            }
            asset = (await created.json()) as Record<string, unknown>;
        } else if (assetResponse.ok) {
            asset = (await assetResponse.json()) as Record<string, unknown>;
            if (asset.state !== "draft") {
                await this.request(
                    base,
                    "POST",
                    `/api/runbooks/${encodeURIComponent(artifact.id)}/revert-to-draft`,
                );
                assetResponse = await this.request(
                    base,
                    "GET",
                    `/api/runbooks/${encodeURIComponent(artifact.id)}`,
                );
                asset = (await assetResponse.json()) as Record<string, unknown>;
            }
        } else {
            throw launchRefusalError(`publish-read-http-${assetResponse.status}`);
        }

        const put = await this.request(
            base,
            "PUT",
            `/api/runbooks/${encodeURIComponent(artifact.id)}`,
            {
                ...asset,
                plan: translation.plan,
                inputSchema: translation.plan.inputSchema,
                regions: (asset.regions as unknown[]) ?? [],
            },
            String(asset.revisionId ?? ""),
        );
        if (!put.ok) {
            throw launchRefusalError(`publish-update-http-${put.status}`);
        }
        const approve = await this.request(
            base,
            "POST",
            `/api/runbooks/${encodeURIComponent(artifact.id)}/approve`,
            {},
        );
        if (!approve.ok) {
            throw launchRefusalError(`publish-approve-http-${approve.status}`);
        }
        const approved = (await approve.json()) as { versionLabel?: string };
        return approved.versionLabel ?? "1.00";
    }

    /** Planner-authored plans launch their library asset AS-IS: verify it
     *  still exists (the user may have archived/purged it), approve it when
     *  it is still a draft, and return the version label to launch. */
    private async ensureLibraryAssetApproved(
        assetId: string,
        context: RunbookOperationContext,
    ): Promise<string> {
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(
            runtime.baseUrl,
            "GET",
            `/api/runbooks/${encodeURIComponent(assetId)}`,
        );
        if (response.status === 404) {
            throw launchRefusalError("runbook-not-found");
        }
        if (!response.ok) {
            throw launchRefusalError(`library-read-http-${response.status}`);
        }
        const asset = (await response.json()) as { state?: string; versionLabel?: string };
        if (asset.state !== "approved") {
            const approve = await this.request(
                runtime.baseUrl,
                "POST",
                `/api/runbooks/${encodeURIComponent(assetId)}/approve`,
                {},
            );
            if (!approve.ok) {
                throw launchRefusalError(`approve-http-${approve.status}`);
            }
            const approved = (await approve.json()) as { versionLabel?: string };
            return approved.versionLabel ?? asset.versionLabel ?? "1.00";
        }
        return asset.versionLabel ?? "1.00";
    }

    // -- library surface (R3, D-0012) ---------------------------------------

    /** Publish the artifact to the runtime library WITHOUT running it —
     *  wraps the run-path publish flow with an empty parameter record (the
     *  translator falls back to declared parameter defaults). Returns the
     *  approved version label. The caller (extension layer) owns the
     *  artifact stash write — this adapter never touches vscode APIs. */
    public async publishOnly(
        artifact: RunbookArtifactFile,
        context: RunbookOperationContext,
    ): Promise<string> {
        return this.publishArtifact(artifact, {}, context);
    }

    /** List the runtime library's runbook assets INCLUDING archived ones —
     *  the tree renders archived assets in a dedicated bottom group with a
     *  Restore command (the state field distinguishes them). */
    public async listLibrary(context: RunbookOperationContext): Promise<RunbookLibraryAsset[]> {
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(
            runtime.baseUrl,
            "GET",
            "/api/runbooks?includeArchived=true",
        );
        if (!response.ok) {
            throw new Error(`library list failed (HTTP ${response.status})`);
        }
        return parseLibraryListResponse(await response.json());
    }

    /** Create an EMPTY draft asset in the runtime library (library-first
     *  New Runbook). The runtime honors the caller-supplied id, so the
     *  local stash artifact can share it for an exact open round-trip. */
    public async createLibraryAsset(
        request: { id: string; title: string; description?: string; category?: string },
        context: RunbookOperationContext,
    ): Promise<void> {
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(runtime.baseUrl, "POST", "/api/runbooks", {
            id: request.id,
            title: request.title,
            description: request.description ?? "",
            ...(request.category ? { category: request.category } : {}),
        });
        if (!response.ok) {
            throw new Error(`library create failed (HTTP ${response.status})`);
        }
    }

    /** Update ONLY the given metadata fields (title/category) of a library
     *  asset: GET the full record for its revisionId, then PUT the full
     *  asset back with If-Match and just those fields changed. NOTE the
     *  runtime's save semantics: any PUT on an approved asset reverts it to
     *  draft with a minor version bump (RevertToDraftOnEdit) — the launch
     *  path re-approves drafts automatically, so this stays runnable. */
    public async updateLibraryAssetFields(
        id: string,
        changes: { title?: string; category?: string },
        context: RunbookOperationContext,
    ): Promise<void> {
        const runtime = await this.supervisor.ensureRunning(context);
        const read = await this.request(
            runtime.baseUrl,
            "GET",
            `/api/runbooks/${encodeURIComponent(id)}`,
        );
        if (read.status === 404) {
            throw new Error(`library update failed (runbook '${id}' not found)`);
        }
        if (!read.ok) {
            throw new Error(`library update failed (read HTTP ${read.status})`);
        }
        const asset = (await read.json()) as Record<string, unknown>;
        // Skip a no-op PUT: any save reverts approved assets to draft
        // (RunbookStore.RevertToDraftOnEdit), so writing an identical
        // title/category would demote for nothing.
        const unchanged =
            (changes.title === undefined || changes.title === asset.title) &&
            (changes.category === undefined || changes.category === asset.category);
        if (unchanged) {
            return;
        }
        const put = await this.request(
            runtime.baseUrl,
            "PUT",
            `/api/runbooks/${encodeURIComponent(id)}`,
            {
                ...asset,
                ...(changes.title !== undefined ? { title: changes.title } : {}),
                ...(changes.category !== undefined ? { category: changes.category } : {}),
            },
            String(asset.revisionId ?? ""),
        );
        if (!put.ok) {
            throw new Error(`library update failed (HTTP ${put.status})`);
        }
    }

    /** Restore an archived library asset back to draft. */
    public async restoreLibraryAsset(id: string, context: RunbookOperationContext): Promise<void> {
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(
            runtime.baseUrl,
            "POST",
            `/api/runbooks/${encodeURIComponent(id)}/restore`,
            {},
        );
        if (!response.ok) {
            throw new Error(`library restore failed (HTTP ${response.status})`);
        }
    }

    /** Delete ALL persisted run history for a library runbook; returns the
     *  number of runs removed (0 when there was none — idempotent). */
    public async deleteLibraryRunHistory(
        id: string,
        context: RunbookOperationContext,
    ): Promise<number> {
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(
            runtime.baseUrl,
            "DELETE",
            `/api/library/content/runbook/${encodeURIComponent(id)}/runs`,
        );
        if (!response.ok) {
            throw new Error(`library run-history delete failed (HTTP ${response.status})`);
        }
        const body = (await response.json().catch(() => undefined)) as
            | { deletedCount?: number }
            | undefined;
        return typeof body?.deletedCount === "number" ? body.deletedCount : 0;
    }

    /** Permanently delete a library asset. The runtime only hard-deletes
     *  ARCHIVED assets (409 otherwise) — the caller archives first. A 404
     *  is tolerated: the asset is already gone, which is the goal state. */
    public async purgeLibraryAsset(id: string, context: RunbookOperationContext): Promise<void> {
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(
            runtime.baseUrl,
            "DELETE",
            `/api/runbooks/${encodeURIComponent(id)}`,
        );
        if (!response.ok && response.status !== 404) {
            throw new Error(`library delete failed (HTTP ${response.status})`);
        }
    }

    /** Full library asset record by id; undefined when it does not exist. */
    public async getLibraryAsset(
        id: string,
        context: RunbookOperationContext,
    ): Promise<Record<string, unknown> | undefined> {
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(
            runtime.baseUrl,
            "GET",
            `/api/runbooks/${encodeURIComponent(id)}`,
        );
        if (response.status === 404) {
            return undefined;
        }
        if (!response.ok) {
            throw new Error(`library read failed (HTTP ${response.status})`);
        }
        return (await response.json()) as Record<string, unknown>;
    }

    /** Read the optimistic-concurrency baseline for one open virtual
     *  document. The content fingerprint ignores lifecycle-only revisions. */
    public async getLibraryDocumentBaseline(
        id: string,
        context: RunbookOperationContext,
    ): Promise<LibraryDocumentBaseline | undefined> {
        const asset = await this.getLibraryAsset(id, context);
        return asset ? libraryBaseline(id, asset) : undefined;
    }

    /** Ctrl+S transaction: compare the open-document baseline to the runtime
     *  head, merge the artifact into that head, and PUT with If-Match. The
     *  caller writes the local stash only after this returns committed.
     *
     *  Runtime-planner (`hobbes.native`) locks are intentionally one-way:
     *  save preserves the runtime's rich plan while committing extension-
     *  owned metadata/source projection. Catalog-native locks are translated
     *  and replace the runtime plan. */
    public async commitLibraryDocument(
        id: string,
        artifact: RunbookArtifactFile,
        expected: LibraryDocumentBaseline | undefined,
        resolution: LibraryDocumentConflictResolution,
        context: RunbookOperationContext,
    ): Promise<LibraryDocumentCommitResult> {
        const runtime = await this.supervisor.ensureRunning(context);
        const route = `/api/runbooks/${encodeURIComponent(id)}`;
        const read = await this.request(runtime.baseUrl, "GET", route);
        if (read.status === 404) {
            throw new Error(`library save failed (runbook '${id}' not found)`);
        }
        if (!read.ok) {
            throw new Error(`library save failed (read HTTP ${read.status})`);
        }
        const head = (await read.json()) as Record<string, unknown>;
        const current = libraryBaseline(id, head);
        const canRebase =
            expected?.extensionArtifact !== undefined && current.extensionArtifact !== undefined;
        if (resolution === "rebase" && !canRebase) {
            return { status: "conflict", baseline: current, canRebase: false };
        }
        const artifactNext =
            resolution === "rebase"
                ? rebaseLibraryArtifact(
                      expected!.extensionArtifact,
                      artifact,
                      current.extensionArtifact,
                  )
                : artifact;
        // The library reference, not the presence of a fallback node, is the
        // authority signal. A runtime-authored plan containing only mapped SQL
        // and Report nodes is still one-way and must not be regenerated from
        // the extension projection on save.
        const hasNativePlan = hasRuntimeLibraryAuthority(artifactNext);
        const metadataNext: Record<string, unknown> = {
            ...head,
            title: artifactNext.name,
            description: artifactNext.description ?? artifactNext.source.intent,
            ...(artifactNext.family ? { category: artifactNext.family } : {}),
            sourcePromptText: artifactNext.source.intent,
            clientExtensions: {
                ...(isRecordValue(head.clientExtensions) ? head.clientExtensions : {}),
                vscodeMssqlArtifact: artifactNext,
            },
        };
        const concurrentContentChange =
            expected === undefined ||
            expected.assetId !== id ||
            (expected.revisionId !== current.revisionId &&
                (hasNativePlan
                    ? expected.extensionFingerprint !== current.extensionFingerprint
                    : expected.contentFingerprint !== current.contentFingerprint));
        if (resolution === "normal" && concurrentContentChange) {
            return { status: "conflict", baseline: current, canRebase };
        }

        let planPatch: Record<string, unknown> = {};
        if (artifactNext.lock && !hasNativePlan) {
            const translation = translateArtifactToHobbesPlan(artifactNext);
            if (!translation.plan) {
                throw new RuntimeStartRefusedError(
                    {
                        code: "RunbookStudio.RuntimeCapabilityUnsupported",
                        message: LocRunbookStudio.hobbesPublishRefused(
                            translation.issues.join("; "),
                        ),
                    },
                    "publish-untranslatable",
                );
            }
            planPatch = {
                plan: translation.plan,
                inputSchema: translation.plan.inputSchema,
            };
        }
        const next: Record<string, unknown> = { ...metadataNext, ...planPatch };
        if (libraryContentFingerprint(next) === current.contentFingerprint) {
            return {
                status: "committed",
                baseline: current,
                ...(typeof head.versionLabel === "string"
                    ? { versionLabel: head.versionLabel }
                    : {}),
            };
        }

        const put = await this.request(runtime.baseUrl, "PUT", route, next, current.revisionId);
        if (put.status === 409) {
            const raced = await this.getLibraryAsset(id, context);
            const racedBaseline = raced ? libraryBaseline(id, raced) : current;
            return {
                status: "conflict",
                baseline: racedBaseline,
                canRebase:
                    expected?.extensionArtifact !== undefined &&
                    racedBaseline.extensionArtifact !== undefined,
            };
        }
        if (!put.ok) {
            throw new Error(`library save failed (HTTP ${put.status})`);
        }
        const saved = (await put.json()) as Record<string, unknown>;
        return {
            status: "committed",
            baseline: libraryBaseline(id, saved),
            ...(typeof saved.versionLabel === "string" ? { versionLabel: saved.versionLabel } : {}),
        };
    }

    /** Recent run history for a library runbook, from the Library detail
     *  endpoint. A missing asset (404) or an unparseable body is an EMPTY
     *  history — never a throw — so the tree renders "no runs yet" instead
     *  of failing the whole branch; other HTTP failures still throw (the
     *  caller renders those honestly as an informational node). */
    public async getLibraryContentDetail(
        assetId: string,
        context: RunbookOperationContext,
    ): Promise<{ recentRuns: LibraryRunRef[] }> {
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(
            runtime.baseUrl,
            "GET",
            `/api/library/content/runbook/${encodeURIComponent(assetId)}`,
        );
        if (response.status === 404) {
            return { recentRuns: [] };
        }
        if (!response.ok) {
            throw new Error(`library detail failed (HTTP ${response.status})`);
        }
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            return { recentRuns: [] };
        }
        return { recentRuns: parseLibraryDetailResponse(body) };
    }

    /** Archive a library asset (recoverable lifecycle transition — never
     *  the destructive purge). */
    public async archiveLibraryAsset(id: string, context: RunbookOperationContext): Promise<void> {
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(
            runtime.baseUrl,
            "POST",
            `/api/runbooks/${encodeURIComponent(id)}/archive`,
            {},
        );
        if (!response.ok) {
            throw new Error(`library archive failed (HTTP ${response.status})`);
        }
    }

    // -- runtime planner (R1.2, D-0010) --------------------------------------

    /**
     * Drive the runtime's elicitation planner: POST the prompt and stream
     * the NDJSON session until the terminal `runbook-asset` (the asset is
     * ALREADY saved in the runtime library as a draft) or `error` event.
     * Direct fetch — NOT this.request — because the session streams for
     * 1-5 minutes, far past the shared request budget.
     */
    public async planFromPrompt(
        promptText: string,
        context: RunbookOperationContext,
        onProgress?: (event: RbsPlannerProgressEvent) => void,
        target?: { assetId: string; revisionId: string },
    ): Promise<PlannedRunbook> {
        const runtime = await this.supervisor.ensureRunning(context);
        const controller = new AbortController();
        // Exposed for user cancellation (single planner session at a time).
        this.activePlannerAbort = controller;
        this.plannerCancelRequested = false;
        const timer = setTimeout(() => controller.abort(), PLANNER_TIMEOUT_MS);
        const coalescer = new ReasoningCoalescer((text) =>
            onProgress?.({ kind: "reasoning", text }),
        );
        let inputsProposed = false;
        try {
            const response = await fetch(`${runtime.baseUrl}/api/runbooks/from-prompt`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/x-ndjson",
                },
                body: JSON.stringify(plannerRequestBody(promptText, target)),
                signal: controller.signal,
            });
            if (!response.ok || !response.body) {
                throw plannerRefusedError(`http-${response.status}`);
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            for (;;) {
                const { done, value } = await reader.read();
                if (value) {
                    buffer += decoder.decode(value, { stream: !done });
                }
                const lines: string[] = [];
                let newline: number;
                while ((newline = buffer.indexOf("\n")) >= 0) {
                    lines.push(buffer.slice(0, newline));
                    buffer = buffer.slice(newline + 1);
                }
                if (done && buffer.trim().length > 0) {
                    // The terminal event may not be newline-terminated.
                    lines.push(buffer);
                    buffer = "";
                }
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) {
                        continue;
                    }
                    let event: PlannerStreamEvent;
                    try {
                        event = JSON.parse(trimmed) as PlannerStreamEvent;
                    } catch {
                        // Malformed line: skip (thinking deltas can be huge).
                        continue;
                    }
                    // Deadline flush: a partially filled reasoning buffer
                    // rides out on the next event past the 500ms mark.
                    coalescer.poke(Date.now());
                    if (event.type === "build-turn-started") {
                        coalescer.flush();
                        emitRunbookEvent(context, "runbookStudio.planner.turn", "ok", {
                            turnLabel: metaField(event.turnLabel ?? String(event.turnSeq ?? "")),
                        });
                        onProgress?.({
                            kind: "turn-started",
                            ...(event.turnSeq !== undefined ? { seq: event.turnSeq } : {}),
                            ...(event.turnLabel ? { label: event.turnLabel } : {}),
                            ...(event.turnKind ? { turnKind: event.turnKind } : {}),
                        });
                    } else if (event.type === "build-turn-completed") {
                        coalescer.flush();
                        onProgress?.({
                            kind: "turn-completed",
                            ...(event.turnSeq !== undefined ? { seq: event.turnSeq } : {}),
                            ...(event.turnLabel ? { label: event.turnLabel } : {}),
                            ...(event.turnKind ? { turnKind: event.turnKind } : {}),
                            ...(event.durationMs !== undefined
                                ? { durationMs: event.durationMs }
                                : {}),
                            ...(event.response
                                ? { text: event.response.slice(0, TURN_SUMMARY_MAX_CHARS) }
                                : {}),
                        });
                    } else if (event.type === "sql-expert-thinking") {
                        if (event.kind === "reasoning") {
                            coalescer.append(event.delta ?? "", Date.now());
                        } else if (event.kind === "tool-call") {
                            coalescer.flush();
                            onProgress?.({
                                kind: "tool-call",
                                ...(event.toolName ? { toolName: event.toolName } : {}),
                                ...(event.delta ? { text: event.delta } : {}),
                            });
                        } else if (event.kind === "status") {
                            // Status is a coalescing boundary only.
                            coalescer.flush();
                        }
                        // "prompt" carries multi-KB prompt text: skipped
                        // entirely (the Debug Console covers deep inspection).
                    } else if (event.type === "planner-elicitation-session-started") {
                        onProgress?.({
                            kind: "phase",
                            text: LocRunbookStudio.plannerPhaseSessionStarted,
                        });
                    } else if (event.type === "planner-input-schema-proposed") {
                        if (!inputsProposed) {
                            inputsProposed = true;
                            const names = (event.inputs ?? [])
                                .map((input) => input?.name)
                                .filter(
                                    (name): name is string =>
                                        typeof name === "string" && name.length > 0,
                                );
                            onProgress?.({ kind: "inputs-proposed", text: names.join(", ") });
                        }
                    } else if (event.type === "plan-synthesized") {
                        onProgress?.({
                            kind: "phase",
                            text: LocRunbookStudio.plannerPhasePlanSynthesized,
                        });
                    } else if (event.type === "plan-dry-run-passed") {
                        onProgress?.({
                            kind: "phase",
                            text: LocRunbookStudio.plannerPhaseDryRunPassed,
                        });
                    } else if (event.type === "error") {
                        throw plannerRefusedError(event.message ?? "planner-error");
                    } else if (event.type === "runbook-asset" && event.asset) {
                        coalescer.flush();
                        const planned = mapPlannerAsset(event.asset);
                        emitRunbookEvent(context, "runbookStudio.planner.end", "ok", {
                            nodeCount: metaField(planned.plan.nodes.length),
                            inputCount: metaField(planned.inputSchema.length),
                        });
                        return planned;
                    }
                    // All other event kinds are progress-only: ignored.
                }
                if (done) {
                    coalescer.flush();
                    throw plannerRefusedError("stream-ended-without-asset");
                }
            }
        } catch (error) {
            emitRunbookEvent(context, "runbookStudio.planner.end", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            if (error instanceof RuntimeStartRefusedError) {
                throw error;
            }
            if (error instanceof Error && error.name === "AbortError") {
                if (this.plannerCancelRequested) {
                    throw new RuntimeStartRefusedError(
                        {
                            code: "RunbookStudio.Cancelled",
                            message: LocRunbookStudio.plannerCancelled,
                        },
                        "planner-cancelled",
                    );
                }
                throw new RuntimeStartRefusedError(
                    {
                        code: "RunbookStudio.Timeout",
                        message: LocRunbookStudio.hobbesPlannerTimeout,
                        retryable: true,
                    },
                    "planner-timeout",
                );
            }
            throw plannerRefusedError(error instanceof Error ? error.message : String(error));
        } finally {
            this.activePlannerAbort = undefined;
            clearTimeout(timer);
            // Release the stream on early exits (error event / mapping
            // refusal) — the runtime would otherwise keep streaming into a
            // dead socket. A no-op after clean completion.
            controller.abort();
        }
    }

    /** POST the workflow.continue COMMAND turn and stream region lifecycle
     *  events back as boundary observations. The envelope kind matters: only
     *  the command path (RuntimeCommandDispatcher) performs the lazy MCP
     *  connection bootstrap before kicking off the workflow — the
     *  workflow-control envelope skips it, and every SQL region then fails
     *  with "no connection was established for input 'database'". */
    private async kickoffAndStream(
        baseUrl: string,
        request: RuntimeStartRequest,
        hobbesRunId: string,
        poll: ActivePoll,
        observer: RuntimeEventObserver,
    ): Promise<void> {
        const knownNodeIds = poll.knownNodeIds;
        const reported = poll.reportedNodeStates;
        const emittedWidgetIds = new Set<string>();
        const emittedExecutedQueries = new Map<string, string>();
        try {
            const response = await fetch(`${baseUrl}/agui`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "text/event-stream",
                },
                body: JSON.stringify({
                    threadId: hobbesRunId,
                    runId: `vscode-${Date.now().toString(36)}`,
                    messages: [
                        {
                            id: `command:workflow.continue:${Date.now().toString(36)}`,
                            role: "user",
                            content: JSON.stringify({
                                hobbesKind: "command",
                                regionId: null,
                                nodeId: null,
                                payload: {
                                    action: "workflow.continue",
                                    payload: { regionId: null },
                                },
                            }),
                        },
                    ],
                    state: {},
                    tools: [],
                    context: [],
                    forwardedProps: {},
                }),
            });
            if (!response.ok || !response.body) {
                observer.onGap(1);
                return;
            }
            observer.onEvent({ kind: "runState", state: "running" });
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            for (;;) {
                const { done, value } = await reader.read();
                if (done || poll.stop) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                let boundary: number;
                while ((boundary = buffer.indexOf("\n\n")) >= 0) {
                    const frame = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    const data = frame
                        .split("\n")
                        .filter((l) => l.startsWith("data:"))
                        .map((l) => l.slice(5).trim())
                        .join("");
                    if (!data) {
                        continue;
                    }
                    try {
                        const event = JSON.parse(data) as {
                            type?: string;
                            snapshot?: {
                                hobbesKind?: string;
                                regionId?: string | null;
                                payload?: HobbesSnapshotPayload;
                            };
                        };
                        const envelope = event.snapshot;
                        if (event.type !== "STATE_SNAPSHOT" || !envelope?.hobbesKind) {
                            continue;
                        }
                        if (envelope.hobbesKind === "investigation-snapshot" && envelope.payload) {
                            // The runtime broadcasts its full investigation
                            // clone after every primitive. Region reports
                            // carry exact executed-query detail; widgets carry
                            // result data (table rows, threshold text, report
                            // assessment). Retain each through its distinct
                            // boundary path without treating query text as a
                            // presentation output.
                            this.emitSnapshotExecutedQueries(
                                envelope.payload,
                                knownNodeIds,
                                reported,
                                emittedExecutedQueries,
                                observer,
                            );
                            this.emitSnapshotWidgetOutputs(
                                envelope.payload,
                                knownNodeIds,
                                reported,
                                emittedWidgetIds,
                                observer,
                            );
                            continue;
                        }
                        if (
                            envelope.hobbesKind === "region-lifecycle" &&
                            envelope.regionId &&
                            knownNodeIds.has(envelope.regionId)
                        ) {
                            const phase = envelope.payload?.phase ?? envelope.payload?.status ?? "";
                            const state = phase.includes("failed")
                                ? "failed"
                                : phase.includes("completed")
                                  ? "succeeded"
                                  : phase.includes("started") || phase.includes("active")
                                    ? "running"
                                    : undefined;
                            if (state && reported.get(envelope.regionId) !== state) {
                                reported.set(envelope.regionId, state);
                                if (state === "failed") {
                                    poll.failedNodeAt ??= Date.now();
                                }
                                observer.onEvent({
                                    kind: "nodeState",
                                    nodeId: envelope.regionId,
                                    state,
                                    attempt: 1,
                                    ...(state === "succeeded"
                                        ? { outcome: "success" as const }
                                        : state === "failed"
                                          ? { outcome: "failure" as const }
                                          : {}),
                                });
                            }
                        }
                    } catch {
                        // Malformed frame: count and continue (never crash the stream).
                        observer.onGap(1);
                    }
                }
            }
        } catch {
            // Stream loss is not terminal — the state poll below remains the
            // authoritative completion signal.
            observer.onGap(1);
        }
    }

    /** Full runtime settings document (safe projection — secrets omitted by
     *  the runtime; the PUT round-trip is the runtime's own supported edit
     *  path per its FR-308 comment). */
    public async getRuntimeSettingsDocument(
        context: RunbookOperationContext,
    ): Promise<Record<string, unknown>> {
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(runtime.baseUrl, "GET", "/runtime/settings");
        if (!response.ok) {
            throw new Error(`settings read failed (HTTP ${response.status})`);
        }
        return (await response.json()) as Record<string, unknown>;
    }

    /** Bounded readiness probe for the runtime's active provider profile. */
    public async getProviderStatus(
        context: RunbookOperationContext,
    ): Promise<HobbesProviderStatus> {
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(runtime.baseUrl, "GET", "/auth/status");
        if (!response.ok) {
            throw new Error(`provider status failed (HTTP ${response.status})`);
        }
        const status = parseHobbesProviderStatus(await response.json());
        if (!status) {
            throw new Error("provider status response was invalid");
        }
        return status;
    }

    /** Drive the runtime-owned provider login flow. Device-code data is
     * surfaced through a bounded callback; provider prose is deliberately
     * not forwarded. */
    public async loginProvider(
        context: RunbookOperationContext,
        onEvent: (event: HobbesProviderLoginEvent) => void,
        signal?: AbortSignal,
    ): Promise<"succeeded" | "failed" | "cancelled"> {
        const runtime = await this.supervisor.ensureRunning(context);
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
            controller.abort();
        }
        const timer = setTimeout(abort, PROVIDER_LOGIN_TIMEOUT_MS);
        try {
            const response = await fetch(`${runtime.baseUrl}/auth/provider/login`, {
                method: "POST",
                headers: { accept: "text/event-stream" },
                signal: controller.signal,
            });
            if (!response.ok || !response.body) {
                return "failed";
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            for (;;) {
                const { done, value } = await reader.read();
                buffer += decoder.decode(value, { stream: !done });
                let match = /\r?\n\r?\n/.exec(buffer);
                while (match?.index !== undefined) {
                    const frame = buffer.slice(0, match.index);
                    buffer = buffer.slice(match.index + match[0].length);
                    const event = parseHobbesProviderLoginFrame(frame);
                    if (event) {
                        onEvent(event);
                        if (event.kind === "succeeded" || event.kind === "failed") {
                            return event.kind;
                        }
                    }
                    match = /\r?\n\r?\n/.exec(buffer);
                }
                if (done) {
                    const event = parseHobbesProviderLoginFrame(buffer);
                    if (event) {
                        onEvent(event);
                        if (event.kind === "succeeded" || event.kind === "failed") {
                            return event.kind;
                        }
                    }
                    return "failed";
                }
            }
        } catch (error) {
            if (signal?.aborted) {
                return "cancelled";
            }
            if (controller.signal.aborted) {
                return "failed";
            }
            throw error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
        }
    }

    /** PUT the (mutated) settings document. Returns an error string on
     *  refusal (409 in-flight guard / 422 validation) instead of throwing. */
    public async putRuntimeSettingsDocument(
        document: Record<string, unknown>,
        context: RunbookOperationContext,
    ): Promise<string | undefined> {
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(runtime.baseUrl, "PUT", "/runtime/settings", document);
        if (response.ok) {
            return undefined;
        }
        const body = (await response.json().catch(() => undefined)) as
            | { errors?: Array<{ message?: string }>; message?: string }
            | undefined;
        return (
            body?.errors?.map((e) => e.message).join("; ") ??
            body?.message ??
            `HTTP ${response.status}`
        );
    }

    public async initialize(context: RunbookOperationContext): Promise<RuntimeCapabilities> {
        const runtime = await this.supervisor.ensureRunning(context);
        return {
            runtimeKind: "hobbes",
            runtimeVersion: runtime.metadata.version ?? "unknown",
            protocolVersion: "hobbes-rest/1",
            supportsCancellation: true,
            // Gates ride the runtime's suspendable wait.signal primitive:
            // real suspension (executionStatus "waiting-signal") + resume
            // via /api/wait-signals (verified surface).
            supportsGates: true,
            supportsResume: runtime.metadata.supports?.checkpointing === true,
            maxConcurrentRuns: 1,
        };
    }

    public async validate(
        artifact: RunbookArtifactFile,
        context: RunbookOperationContext,
    ): Promise<{ ok: boolean; issues: RuntimeValidationIssue[] }> {
        const runtime = await this.supervisor.ensureRunning(context);
        // The artifact references a runtime-library runbook by id; existence
        // is the validation the boundary can honestly offer.
        const response = await this.request(
            runtime.baseUrl,
            "GET",
            `/api/runbooks/${encodeURIComponent(artifact.id)}/${encodeURIComponent(
                artifact.lock?.planRevision ?? "latest",
            )}`,
        );
        if (response.status === 404) {
            return {
                ok: false,
                issues: [{ detail: `runbook '${artifact.id}' not found in the runtime library` }],
            };
        }
        return { ok: response.ok, issues: [] };
    }

    public async startRun(
        request: RuntimeStartRequest,
        observer: RuntimeEventObserver,
        context: RunbookOperationContext,
    ): Promise<void> {
        try {
            await this.startRunAttempt(request, observer, context);
            return;
        } catch (error) {
            // Typed refusals are honest answers — never retry those.
            if (error instanceof RuntimeStartRefusedError) {
                throw error;
            }
            // Anything else (AbortError timeout, fetch failed) may mean the
            // runtime process is WEDGED while still alive — observed live:
            // blocked post-run summarizer dispatches starved the runtime and
            // every later HTTP call timed out forever, with no process exit
            // to trip recovery. Probe health; if it is truly unresponsive,
            // restart it and retry the whole start sequence once.
            const healthy = await this.probeHealth();
            if (healthy) {
                throw error;
            }
            emitRunbookEvent(context, "runbookStudio.runtime.unresponsiveRestart", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "unknown"),
            });
            await this.supervisor.restart(context);
            try {
                await this.startRunAttempt(request, observer, context);
            } catch (retryError) {
                if (retryError instanceof RuntimeStartRefusedError) {
                    throw retryError;
                }
                // A timeout again means the fresh runtime is also wedged —
                // report that; any other failure keeps its own message.
                throw retryError instanceof Error && retryError.name === "AbortError"
                    ? new Error(LocRunbookStudio.hobbesRuntimeUnresponsive)
                    : retryError;
            }
        }
    }

    /** True when the current runtime answers /health within a short budget. */
    private async probeHealth(): Promise<boolean> {
        const baseUrl = this.supervisor.baseUrl;
        if (!baseUrl) {
            return false;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
        try {
            const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
            return response.ok;
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    private async startRunAttempt(
        request: RuntimeStartRequest,
        observer: RuntimeEventObserver,
        context: RunbookOperationContext,
    ): Promise<void> {
        const runtime = await this.supervisor.ensureRunning(context);
        this.supervisor.onExit((unexpected) => {
            const poll = this.polls.get(request.runId);
            if (poll && !poll.stop) {
                poll.stop = true;
                observer.onExit(unexpected);
            }
        });

        // Split bindings: the connection-typed parameter rides the legacy
        // connectionAlias field; everything else goes to inputValues.
        const connectionParameter = request.artifact.source.parameters.find(
            (p) => p.type === "connection",
        );
        const connectionAlias =
            connectionParameter && request.parameterValues[connectionParameter.id] != null
                ? String(request.parameterValues[connectionParameter.id])
                : "";
        // 1. Bridge the connection: register the selected profile in the
        // runtime's JsonFile registry (integrated auth only — credentials
        // never enter the file) and use its alias for the launch.
        const alias = await this.ensureConnectionBridged(runtime.baseUrl, connectionAlias, context);

        // 2. Resolve the runtime-library runbook to launch. Planner-authored
        // locks reference the library asset the planner already saved —
        // launch it directly, never translate the lock. Catalog-compiled
        // locks publish through the translator as before (create/update ->
        // approve); untranslatable plans refuse with exact reasons.
        const libraryAssetRef = request.artifact.lock?.libraryAssetRef;
        const runbookId = libraryAssetRef?.assetId ?? request.artifact.id;
        const versionLabel = libraryAssetRef
            ? await this.ensureLibraryAssetApproved(libraryAssetRef.assetId, context)
            : await this.publishArtifact(request.artifact, request.parameterValues ?? {}, context);

        // The connection bridge may have RESTARTED the runtime onto a new
        // port — re-resolve before every post-bridge call (a stale base URL
        // here surfaced live as a TypeError mid-start).
        const live = await this.supervisor.ensureRunning(context);
        const activeBaseUrl = live.baseUrl;

        // 3. Launch + confirm (mounts the investigation).
        const launch = await this.request(activeBaseUrl, "POST", "/api/investigations/launch", {
            runbookId,
            runbookVersion: versionLabel,
            connectionAlias: alias,
        });
        const launchBody = (await launch.json().catch(() => undefined)) as
            | { runId?: string; code?: string; message?: string; error?: string }
            | undefined;
        if (!launch.ok || !launchBody?.runId) {
            // Codeless refusals carry whatever detail the body offered —
            // a bare "http-400" hid the actual reason during live debugging.
            const detail =
                launchBody?.code ??
                [`http-${launch.status}`, launchBody?.error, launchBody?.message]
                    .filter(Boolean)
                    .join(" ")
                    .slice(0, 200);
            throw launchRefusalError(detail);
        }
        const hobbesRunId = launchBody.runId;
        emitRunbookEvent(context, "runbookStudio.runtime.launchPrepared", "ok", {
            hobbesRunIdDigest: metaField(hobbesRunId.length),
        });

        const confirm = await this.request(
            activeBaseUrl,
            "POST",
            `/api/investigations/runs/${encodeURIComponent(hobbesRunId)}/confirm`,
        );
        if (!confirm.ok) {
            throw launchRefusalError(`confirm-http-${confirm.status}`);
        }

        // 4. AG-UI kickoff: mounted runs execute only when the
        // workflow.continue command arrives on the investigation thread; the
        // command dispatcher also establishes the MCP SQL connections. The
        // SSE stream carries region lifecycle events.
        const poll: ActivePoll = {
            stop: false,
            observer,
            knownNodeIds: new Set((request.artifact.lock?.nodes ?? []).map((node) => node.id)),
            reportedNodeStates: new Map(),
            regionMetrics: new Map(),
        };
        this.polls.set(request.runId, poll);
        void this.kickoffAndStream(activeBaseUrl, request, hobbesRunId, poll, observer);
        void this.pollRun(activeBaseUrl, request, hobbesRunId, poll, observer);
    }

    public async cancelRun(
        runId: string,
        context: RunbookOperationContext,
    ): Promise<"cancelled" | "alreadyTerminal" | "failed"> {
        const poll = this.polls.get(runId);
        const hobbesRunId = this.hobbesRunIds.get(runId);
        if (!poll || poll.stop || !hobbesRunId) {
            return "alreadyTerminal";
        }
        const runtime = await this.supervisor.ensureRunning(context);
        const response = await this.request(
            runtime.baseUrl,
            "POST",
            `/api/investigations/runs/${encodeURIComponent(hobbesRunId)}/cancel`,
            { reason: "user-cancelled" },
        );
        if (!response.ok) {
            return "failed";
        }
        // The runtime accepts the cancel but neither the run record nor the
        // investigation's executionStatus reflects it (observed live: the
        // Cancel button "did nothing" — the poll spun on forever). The
        // boundary terminalizes honestly itself: cancellation was requested
        // and accepted; stop observing.
        for (const event of terminalNodeSettlementEvents(
            poll.knownNodeIds,
            poll.reportedNodeStates,
            "cancelled",
        )) {
            poll.reportedNodeStates.set(event.nodeId, event.state);
            poll.observer?.onEvent(event);
        }
        poll.stop = true;
        poll.observer?.onEvent(
            withHobbesRunMetrics(poll, { kind: "terminal", state: "cancelled" }),
        );
        return "cancelled";
    }

    /** Abort an in-flight planner session (user cancelled generation). */
    public cancelActivePlanner(): boolean {
        if (!this.activePlannerAbort) {
            return false;
        }
        this.plannerCancelRequested = true;
        this.activePlannerAbort.abort();
        return true;
    }

    /** Gates publish as wait.signal suspensions; approve = persist a resume
     *  payload + trigger a re-entry turn, reject = cancel the run. */
    public async respondToGate(
        runId: string,
        nodeId: string,
        approve: boolean,
        context: RunbookOperationContext,
    ): Promise<boolean> {
        const hobbesRunId = this.hobbesRunIds.get(runId);
        const poll = this.polls.get(runId);
        if (!hobbesRunId || !poll || poll.stop) {
            return false;
        }
        const runtime = await this.supervisor.ensureRunning(context);
        if (!approve) {
            poll.observer?.onEvent({ kind: "gateResponded", nodeId, approved: false });
            const cancelled = await this.cancelRun(runId, context);
            return cancelled === "cancelled";
        }
        const keyPath =
            `/api/wait-signals/${encodeURIComponent(hobbesRunId)}/` +
            encodeURIComponent(gateCorrelationKey(nodeId));
        const resume = await this.request(runtime.baseUrl, "POST", `${keyPath}/resume`, {
            approved: true,
            source: "vscode-runbook-studio",
        });
        if (!resume.ok) {
            return false;
        }
        // Phase-A contract: the payload persists but the workflow only
        // re-enters on the next turn — trigger it explicitly.
        const trigger = await this.request(runtime.baseUrl, "POST", `${keyPath}/trigger-resume`);
        if (!trigger.ok) {
            return false;
        }
        poll.gateRespondedFor = nodeId;
        poll.observer?.onEvent({ kind: "gateResponded", nodeId, approved: true });
        return true;
    }

    public dispose(): Promise<void> {
        for (const poll of this.polls.values()) {
            poll.stop = true;
        }
        this.polls.clear();
        this.supervisor.dispose();
        return Promise.resolve();
    }

    // -----------------------------------------------------------------------

    /** Host runId -> runtime runId (assigned at launch). */
    private readonly hobbesRunIds = new Map<string, string>();

    private async pollRun(
        baseUrl: string,
        request: RuntimeStartRequest,
        hobbesRunId: string,
        poll: ActivePoll,
        observer: RuntimeEventObserver,
    ): Promise<void> {
        this.hobbesRunIds.set(request.runId, hobbesRunId);
        const knownNodeIds = poll.knownNodeIds;
        const reportedNodeStates = poll.reportedNodeStates;
        let reportedRunning = false;
        try {
            for (;;) {
                if (poll.stop) {
                    return;
                }
                let record: HobbesRunRecord | undefined;
                try {
                    const response = await this.request(
                        baseUrl,
                        "GET",
                        `/api/runs/${encodeURIComponent(hobbesRunId)}`,
                    );
                    if (response.ok) {
                        record = (await response.json()) as HobbesRunRecord;
                    }
                } catch {
                    // transient poll failure; the exit listener reports a
                    // dead runtime, so keep polling until stopped.
                }
                if (record) {
                    if (!reportedRunning && record.status === "running") {
                        reportedRunning = true;
                        observer.onEvent({ kind: "runState", state: "running" });
                    }
                    // Region results map onto plan nodes ONLY where ids match
                    // (boundary honesty — no fabricated node progress).
                    for (const region of record.regionResults ?? []) {
                        if (!knownNodeIds.has(region.regionId)) {
                            continue;
                        }
                        recordRegionMetrics(poll, region.regionId, region);
                        const state = mapRegionStatus(region.status);
                        if (!state || reportedNodeStates.get(region.regionId) === state) {
                            continue;
                        }
                        reportedNodeStates.set(region.regionId, state);
                        observer.onEvent({
                            kind: "nodeState",
                            nodeId: region.regionId,
                            state,
                            attempt: 1,
                            ...(state === "succeeded"
                                ? { outcome: "success" as const }
                                : state === "failed"
                                  ? { outcome: "failure" as const }
                                  : {}),
                            ...(region.findingCount !== undefined
                                ? {
                                      output: {
                                          contract: "scalarSet/1",
                                          scalars: {
                                              findings: region.findingCount,
                                              remediations: region.remediationCount ?? 0,
                                          },
                                      },
                                  }
                                : {}),
                        });
                    }
                    const terminal = mapTerminalStatus(record.status);
                    if (terminal) {
                        for (const event of terminalNodeSettlementEvents(
                            knownNodeIds,
                            reportedNodeStates,
                            terminal,
                        )) {
                            reportedNodeStates.set(event.nodeId, event.state);
                            observer.onEvent(event);
                        }
                        poll.stop = true;
                        observer.onEvent(
                            withHobbesRunMetrics(poll, {
                                kind: "terminal",
                                state: terminal,
                                ...(terminal === "succeeded"
                                    ? { verdict: "pass" as const }
                                    : terminal === "failed"
                                      ? { verdict: "fail" as const }
                                      : {}),
                            }),
                        );
                        return;
                    }
                }
                // The run record's status never finalizes on this runtime and
                // its regionResults stay empty (verified live) — the honest
                // terminal is the investigation record's execution.status
                // ("completed"/"failed"; "paused" is the pre-kickoff state).
                // NOTE: /api/investigations/{id}/state is a summary card with
                // NO execution field — polling it froze runs at "running".
                try {
                    const stateResponse = await this.request(
                        baseUrl,
                        "GET",
                        `/api/investigations/${encodeURIComponent(hobbesRunId)}`,
                    );
                    if (stateResponse.ok) {
                        const state = (await stateResponse.json()) as {
                            updatedAt?: string;
                            execution?: { status?: string; activeRegionId?: string | null };
                        };
                        const executionStatus = state.execution?.status;
                        // Progress tracking: updatedAt moves on every runtime
                        // mutation (autosave). A run that is neither suspended
                        // nor terminal but shows NO mutation for the ceiling
                        // is declared failed honestly — the owner-reported
                        // alternative is a silent forever-spinner.
                        if (state.updatedAt !== poll.lastUpdatedAt) {
                            poll.lastUpdatedAt = state.updatedAt;
                            poll.lastProgressEpoch = Date.now();
                        }
                        if (
                            executionStatus === "running" &&
                            poll.lastProgressEpoch !== undefined &&
                            Date.now() - poll.lastProgressEpoch > NO_PROGRESS_TIMEOUT_MS
                        ) {
                            poll.stop = true;
                            observer.onEvent(
                                withHobbesRunMetrics(poll, {
                                    kind: "terminal",
                                    state: "failed",
                                    verdict: "fail",
                                    errorCode: "RunbookStudio.Timeout",
                                    errorMessage: LocRunbookStudio.hobbesRunNoProgress,
                                }),
                            );
                            return;
                        }
                        // Gate suspension: the workflow genuinely stops in
                        // "waiting-signal" on the wait.signal region. Emit
                        // the gate request once per suspended gate node.
                        if (executionStatus === "waiting-signal") {
                            const activeRegionId = state.execution?.activeRegionId ?? undefined;
                            const gateNode = (request.artifact.lock?.nodes ?? []).find(
                                (n) => n.kind === "gate" && n.id === activeRegionId,
                            );
                            if (
                                gateNode &&
                                poll.gateRequestedFor !== gateNode.id &&
                                poll.gateRespondedFor !== gateNode.id
                            ) {
                                poll.gateRequestedFor = gateNode.id;
                                reportedNodeStates.set(gateNode.id, "awaitingApproval");
                                observer.onEvent({
                                    kind: "nodeState",
                                    nodeId: gateNode.id,
                                    state: "awaitingApproval",
                                    attempt: 1,
                                });
                                observer.onEvent({
                                    kind: "gateRequested",
                                    nodeId: gateNode.id,
                                    impactSummary:
                                        gateNode.label || LocRunbookStudio.approvalRequired,
                                });
                            }
                        }
                        if (executionStatus === "completed" || executionStatus === "failed") {
                            const terminalState =
                                executionStatus === "completed" ? "succeeded" : "failed";
                            for (const event of terminalNodeSettlementEvents(
                                knownNodeIds,
                                reportedNodeStates,
                                terminalState,
                            )) {
                                reportedNodeStates.set(event.nodeId, event.state);
                                observer.onEvent(event);
                            }
                            poll.stop = true;
                            observer.onEvent(
                                withHobbesRunMetrics(poll, {
                                    kind: "terminal",
                                    state: terminalState,
                                    verdict: executionStatus === "completed" ? "pass" : "fail",
                                }),
                            );
                            return;
                        }
                    }
                } catch {
                    // transient; keep polling
                }
                // Stall guard: a region failed but the runtime never
                // finalized the investigation (observed live — its post-run
                // summarize step can hang without model auth). Declare the
                // failure honestly instead of spinning forever.
                if (
                    poll.failedNodeAt !== undefined &&
                    Date.now() - poll.failedNodeAt > STALL_AFTER_FAILURE_MS
                ) {
                    poll.stop = true;
                    observer.onEvent(
                        withHobbesRunMetrics(poll, {
                            kind: "terminal",
                            state: "failed",
                            verdict: "fail",
                            errorCode: "RunbookStudio.ActivityFailed",
                            errorMessage: LocRunbookStudio.hobbesRunStalledAfterFailure,
                        }),
                    );
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
            }
        } finally {
            this.polls.delete(request.runId);
            this.hobbesRunIds.delete(request.runId);
        }
    }

    /** Retain runtime-observed SQL as a dedicated result detail. It is not a
     * presentation output and therefore cannot appear as an invented plan
     * slot or dashboard widget. A changed query replaces the node's drill-in
     * handle; repeated full snapshots do not duplicate it. */
    private emitSnapshotExecutedQueries(
        payload: HobbesSnapshotPayload,
        knownNodeIds: Set<string>,
        reported: Map<string, string>,
        emitted: Map<string, string>,
        observer: RuntimeEventObserver,
    ): void {
        for (const query of executedQueriesFromSnapshot(payload, knownNodeIds)) {
            if (emitted.get(query.regionId) === query.queryText) {
                continue;
            }
            const known = reported.get(query.regionId);
            if (known === "skipped" || known === "cancelled") {
                continue;
            }
            emitted.set(query.regionId, query.queryText);
            const state =
                known === "succeeded" || known === "failed"
                    ? (known as "succeeded" | "failed")
                    : "running";
            observer.onEvent({
                kind: "nodeState",
                nodeId: query.regionId,
                state,
                attempt: 1,
                ...(state === "succeeded"
                    ? { outcome: "success" as const }
                    : state === "failed"
                      ? { outcome: "failure" as const }
                      : {}),
                executedQuery: { contract: "sql/1", text: query.queryText },
            });
        }
    }

    /**
     * Translate the widgets inside an investigation snapshot into boundary
     * outputs on their plan nodes (verified shapes, captured live):
     *   table  -> rowset/1 (schema column names + row objects)
     *   text   -> markdown/1 (threshold narrative)
     *   assessment-strip -> markdown/1 (report assessment summary)
     * Widget nodeId is an internal GUID; informationSpace.nodes maps it to
     * the region id, which IS the plan node id. Each widget emits once.
     */
    private emitSnapshotWidgetOutputs(
        payload: HobbesSnapshotPayload,
        knownNodeIds: Set<string>,
        reported: Map<string, string>,
        emittedWidgetIds: Set<string>,
        observer: RuntimeEventObserver,
    ): void {
        const widgets = payload.widgets;
        if (!widgets) {
            return;
        }
        const guidToRegion = new Map<string, string>();
        for (const node of payload.informationSpace?.nodes ?? []) {
            if (node.id && node.regionId) {
                guidToRegion.set(node.id, node.regionId);
            }
        }
        for (const widget of Object.values(widgets)) {
            if (!widget || typeof widget !== "object" || emittedWidgetIds.has(widget.id ?? "")) {
                continue;
            }
            const regionId = widget.nodeId ? guidToRegion.get(widget.nodeId) : undefined;
            if (!widget.id || !regionId || !knownNodeIds.has(regionId)) {
                continue;
            }
            const output = translateWidgetToOutput(widget);
            if (!output) {
                continue;
            }
            emittedWidgetIds.add(widget.id);
            // Appending output to a terminal node re-states its terminal
            // state (allowed); a not-yet-terminal node rides "running".
            const known = reported.get(regionId);
            const state =
                known === "succeeded" || known === "failed"
                    ? (known as "succeeded" | "failed")
                    : "running";
            observer.onEvent({
                kind: "nodeState",
                nodeId: regionId,
                state,
                attempt: 1,
                ...(state === "succeeded"
                    ? { outcome: "success" as const }
                    : state === "failed"
                      ? { outcome: "failure" as const }
                      : {}),
                output,
            });
        }
    }

    private async request(
        baseUrl: string,
        method: "GET" | "POST" | "PUT" | "DELETE",
        pathAndQuery: string,
        body?: unknown,
        ifMatch?: string,
    ): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const headers: Record<string, string> = {
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
            ...(ifMatch ? { "if-match": ifMatch } : {}),
        };
        try {
            return await fetch(`${baseUrl}${pathAndQuery}`, {
                method,
                signal: controller.signal,
                ...(Object.keys(headers).length > 0 ? { headers } : {}),
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            });
        } finally {
            clearTimeout(timer);
        }
    }
}

/** Planner failure -> typed refusal with the exact detail. */
function plannerRefusedError(detail: string): RuntimeStartRefusedError {
    return new RuntimeStartRefusedError(
        {
            code: "RunbookStudio.CompileInvalid",
            message: LocRunbookStudio.hobbesPlannerFailed(detail),
            retryable: true,
        },
        "planner-failed",
    );
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Terminal `runbook-asset` payload -> the boundary PlannedRunbook shape.
 *  Nodes/edges missing stable ids are dropped (never invented); an asset
 *  without an id or nodes refuses with the exact reason. */
function mapPlannerAsset(asset: PlannerAssetPayload): PlannedRunbook {
    const nodes: PlannerPlanNode[] = [];
    for (const node of asset.plan?.nodes ?? []) {
        const projected = projectPlannerNode(node);
        if (projected !== undefined) {
            nodes.push(projected);
        }
    }
    if (typeof asset.id !== "string" || asset.id.length === 0 || nodes.length === 0) {
        throw plannerRefusedError("asset-missing-id-or-nodes");
    }
    const edges: PlannerPlanEdge[] = [];
    for (const edge of asset.plan?.edges ?? []) {
        const projected = projectPlannerEdge(edge);
        if (projected !== undefined) {
            edges.push(projected);
        }
    }
    const inputSchema: Array<{ name: string; kind: string }> = [];
    for (const input of asset.inputSchema ?? []) {
        if (typeof input?.name === "string" && typeof input?.kind === "string") {
            inputSchema.push({ name: input.name, kind: input.kind });
        }
    }
    return {
        assetId: asset.id,
        ...(typeof asset.revisionId === "string" && asset.revisionId.length > 0
            ? { revisionId: asset.revisionId }
            : {}),
        title: typeof asset.title === "string" && asset.title.length > 0 ? asset.title : asset.id,
        plan: {
            nodes,
            edges,
            ...(typeof asset.plan?.entryNodeId === "string" && asset.plan.entryNodeId.length > 0
                ? { entryNodeId: asset.plan.entryNodeId }
                : {}),
        },
        inputSchema,
    };
}

/**
 * Launch refusal -> user-actionable RbsError (codes from the runtime's
 * LaunchErrorCodes contract). The by-far-most-common case is a generated
 * runbook that does not exist in the runtime's library — tell the user
 * exactly that and how to run it instead.
 */
export function launchRefusalError(refusalCode: string): RuntimeStartRefusedError {
    switch (refusalCode) {
        case "runbook-not-found":
        case "runbook-version-mismatch":
            return new RuntimeStartRefusedError(
                {
                    code: "RunbookStudio.RuntimeCapabilityUnsupported",
                    message: LocRunbookStudio.hobbesRunbookNotInLibrary,
                },
                refusalCode,
            );
        case "connection-not-found":
        case "connection-ambiguous":
            return new RuntimeStartRefusedError(
                {
                    code: "RunbookStudio.BindingInvalid",
                    message: LocRunbookStudio.hobbesConnectionNotResolved,
                },
                refusalCode,
            );
        default:
            return new RuntimeStartRefusedError(
                {
                    code: "RunbookStudio.RuntimeProtocol",
                    message: LocRunbookStudio.hobbesLaunchRefused(refusalCode),
                    retryable: true,
                },
                refusalCode,
            );
    }
}

function recordRegionMetrics(
    poll: ActivePoll,
    regionId: string,
    region: { findingCount?: number; remediationCount?: number },
): void {
    const findingCount = boundedRuntimeCount(region.findingCount);
    const remediationCount = boundedRuntimeCount(region.remediationCount);
    if (findingCount === undefined && remediationCount === undefined) {
        return;
    }
    poll.regionMetrics.set(regionId, {
        ...poll.regionMetrics.get(regionId),
        ...(findingCount !== undefined ? { findingCount } : {}),
        ...(remediationCount !== undefined ? { remediationCount } : {}),
    });
}

function withHobbesRunMetrics(
    poll: ActivePoll,
    event: Extract<RuntimeBoundaryEvent, { kind: "terminal" }>,
): Extract<RuntimeBoundaryEvent, { kind: "terminal" }> {
    const runMetrics = summarizeHobbesRegionMetrics(poll.regionMetrics.values());
    return { ...event, ...(runMetrics ? { runMetrics } : {}) };
}

/** Pure projection of the only scalar metrics exposed by the current Hobbes
 * run-record contract. Per-region replacement prevents polling duplicates
 * from inflating totals. */
export function summarizeHobbesRegionMetrics(
    regions: Iterable<{ findingCount?: number; remediationCount?: number }>,
): Record<string, number> | undefined {
    let observed = false;
    let findingCount = 0;
    let remediationCount = 0;
    for (const region of regions) {
        const findings = boundedRuntimeCount(region.findingCount);
        const remediations = boundedRuntimeCount(region.remediationCount);
        if (findings !== undefined) {
            observed = true;
            findingCount = Math.min(Number.MAX_SAFE_INTEGER, findingCount + findings);
        }
        if (remediations !== undefined) {
            observed = true;
            remediationCount = Math.min(Number.MAX_SAFE_INTEGER, remediationCount + remediations);
        }
    }
    return observed
        ? { "findings.total": findingCount, "remediations.total": remediationCount }
        : undefined;
}

function boundedRuntimeCount(value: number | undefined): number | undefined {
    return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Settle nodes for which the runtime produced no execution evidence before
 * the run terminal. On a successful conditional workflow those nodes are
 * the not-taken branch. On failure/cancellation they were never reached.
 * Active nodes are cancelled only after the runtime accepted cancellation;
 * an active node on success/failure remains untouched because guessing its
 * terminal outcome would violate the adapter's boundary-honesty rule.
 */
export function terminalNodeSettlementEvents(
    knownNodeIds: ReadonlySet<string>,
    reportedNodeStates: ReadonlyMap<string, string>,
    terminalState: "succeeded" | "failed" | "cancelled",
): Array<Extract<RuntimeBoundaryEvent, { kind: "nodeState" }>> {
    const events: Array<Extract<RuntimeBoundaryEvent, { kind: "nodeState" }>> = [];
    for (const nodeId of knownNodeIds) {
        const state = reportedNodeStates.get(nodeId);
        if (state === undefined) {
            events.push({
                kind: "nodeState",
                nodeId,
                state: "skipped",
                attempt: 0,
                outcome: "skipped",
                ...(terminalState === "succeeded" ? { branchNotTaken: true } : {}),
                message:
                    terminalState === "succeeded"
                        ? LocRunbookStudio.branchNotTaken
                        : LocRunbookStudio.runEndedBeforeStep,
            });
        } else if (
            terminalState === "cancelled" &&
            (state === "running" || state === "awaitingApproval")
        ) {
            events.push({
                kind: "nodeState",
                nodeId,
                state: "cancelled",
                attempt: 1,
                outcome: "cancelled",
                message: LocRunbookStudio.stepCancelled,
            });
        }
    }
    return events;
}

/** Runtime region status -> node state ("running" regions poll as running). */
export function mapRegionStatus(
    status: string | undefined,
): "running" | "succeeded" | "failed" | undefined {
    switch (status) {
        case "running":
            return "running";
        case "completed":
        case "succeeded":
            return "succeeded";
        case "failed":
            return "failed";
        default:
            return undefined;
    }
}

/** InvestigationRunStatuses -> host terminal states. */
export function mapTerminalStatus(
    status: string | undefined,
): "succeeded" | "failed" | "cancelled" | undefined {
    switch (status) {
        case "completed":
            return "succeeded";
        case "failed":
            return "failed";
        case "canceled":
            return "cancelled";
        default:
            return undefined;
    }
}
