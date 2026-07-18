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
import { RunbookStudio as LocRunbookStudio } from "../../constants/locConstants";
import { RunbookArtifactFile } from "../../sharedInterfaces/runbookStudio";
import { emitRunbookEvent, metaField, RunbookOperationContext } from "../runbookDiag";
import {
    HobbesConnectionsFile,
    mergeConnectionEntry,
    translateArtifactToHobbesPlan,
} from "./hobbesPlanTranslator";
import { RuntimeSupervisor } from "./runtimeSupervisor";
import {
    RunbookRuntimeAdapter,
    RuntimeCapabilities,
    RuntimeEventObserver,
    RuntimeStartRefusedError,
    RuntimeStartRequest,
    RuntimeValidationIssue,
} from "./runtimeAdapterTypes";

const RUN_POLL_INTERVAL_MS = 750;
const REQUEST_TIMEOUT_MS = 15_000;

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

interface ActivePoll {
    stop: boolean;
    /** Epoch of the first failed region report — arms the stall guard (the
     *  runtime can hang post-failure, e.g. on its summarize step: U-2). */
    failedNodeAt?: number;
}

/** After a region failure, give the runtime this long to finalize before
 *  the host declares the run failed (visible, never silent). */
const STALL_AFTER_FAILURE_MS = 60_000;

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
        // The MCP server reads the provider selection at startup; switch the
        // persisted setting and restart the runtime once when needed.
        const settings = (await (
            await this.request(baseUrl, "GET", "/runtime/settings")
        ).json()) as { sqlConnectionProvider?: string };
        if (settings.sqlConnectionProvider !== "jsonfile") {
            await this.request(baseUrl, "PUT", "/runtime/settings", {
                sqlConnectionProvider: "jsonfile",
            });
            emitRunbookEvent(context, "runbookStudio.runtime.providerSwitched", "ok", {
                provider: metaField("jsonfile"),
            });
            await this.supervisor.restart(context);
        }
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
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(merged, undefined, 2));
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
        const knownNodeIds = new Set((request.artifact.lock?.nodes ?? []).map((n) => n.id));
        const reported = new Map<string, string>();
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
                                payload?: { phase?: string; status?: string };
                            };
                        };
                        const envelope = event.snapshot;
                        if (event.type !== "STATE_SNAPSHOT" || !envelope?.hobbesKind) {
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

    public async initialize(context: RunbookOperationContext): Promise<RuntimeCapabilities> {
        const runtime = await this.supervisor.ensureRunning(context);
        return {
            runtimeKind: "hobbes",
            runtimeVersion: runtime.metadata.version ?? "unknown",
            protocolVersion: "hobbes-rest/1",
            supportsCancellation: true,
            // The runtime supports human approval internally, but its launch
            // surface does not expose gate round-trips yet — reported
            // honestly as unsupported at this boundary (A2 §3.3).
            supportsGates: false,
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

        // 2. Publish: translate the compiled lock into the runtime's plan IR
        // and register it in the library via the studio API (create/update ->
        // approve). Untranslatable plans refuse with exact reasons.
        const versionLabel = await this.publishArtifact(
            request.artifact,
            request.parameterValues ?? {},
            context,
        );

        // The connection bridge may have RESTARTED the runtime onto a new
        // port — re-resolve before every post-bridge call (a stale base URL
        // here surfaced live as a TypeError mid-start).
        const live = await this.supervisor.ensureRunning(context);
        const activeBaseUrl = live.baseUrl;

        // 3. Launch + confirm (mounts the investigation).
        const launch = await this.request(activeBaseUrl, "POST", "/api/investigations/launch", {
            runbookId: request.artifact.id,
            runbookVersion: versionLabel,
            connectionAlias: alias,
        });
        const launchBody = (await launch.json().catch(() => undefined)) as
            | { runId?: string; code?: string; message?: string }
            | undefined;
        if (!launch.ok || !launchBody?.runId) {
            throw launchRefusalError(launchBody?.code ?? `http-${launch.status}`);
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
        const poll: ActivePoll = { stop: false };
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
        return response.ok ? "cancelled" : "failed";
    }

    public respondToGate(): Promise<boolean> {
        // Gate round-trips are not exposed by the runtime's launch surface
        // (capability reported false); refusing is the honest answer.
        return Promise.resolve(false);
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
        const knownNodeIds = new Set((request.artifact.lock?.nodes ?? []).map((node) => node.id));
        const reportedNodeStates = new Map<string, string>();
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
                        poll.stop = true;
                        observer.onEvent({
                            kind: "terminal",
                            state: terminal,
                            ...(terminal === "succeeded"
                                ? { verdict: "pass" as const }
                                : terminal === "failed"
                                  ? { verdict: "fail" as const }
                                  : {}),
                        });
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
                            execution?: { status?: string };
                        };
                        const executionStatus = state.execution?.status;
                        if (executionStatus === "completed" || executionStatus === "failed") {
                            poll.stop = true;
                            observer.onEvent({
                                kind: "terminal",
                                state: executionStatus === "completed" ? "succeeded" : "failed",
                                verdict: executionStatus === "completed" ? "pass" : "fail",
                            });
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
                    observer.onEvent({
                        kind: "terminal",
                        state: "failed",
                        verdict: "fail",
                        errorCode: "RunbookStudio.ActivityFailed",
                        errorMessage: LocRunbookStudio.hobbesRunStalledAfterFailure,
                    });
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
            }
        } finally {
            this.polls.delete(request.runId);
            this.hobbesRunIds.delete(request.runId);
        }
    }

    private async request(
        baseUrl: string,
        method: "GET" | "POST" | "PUT",
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
