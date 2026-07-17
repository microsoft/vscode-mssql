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

import { RunbookArtifactFile } from "../../sharedInterfaces/runbookStudio";
import { emitRunbookEvent, metaField, RunbookOperationContext } from "../runbookDiag";
import { RuntimeSupervisor } from "./runtimeSupervisor";
import {
    RunbookRuntimeAdapter,
    RuntimeCapabilities,
    RuntimeEventObserver,
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
}

export class HobbesRuntimeAdapter implements RunbookRuntimeAdapter {
    private readonly polls = new Map<string, ActivePoll>();

    constructor(private readonly supervisor: RuntimeSupervisor) {}

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
        const inputValues: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(request.parameterValues)) {
            if (key !== connectionParameter?.id && value !== null) {
                inputValues[key] = value;
            }
        }

        const launch = await this.request(runtime.baseUrl, "POST", "/api/investigations/launch", {
            runbookId: request.artifact.id,
            ...(request.artifact.lock
                ? { runbookVersion: request.artifact.lock.planRevision }
                : {}),
            connectionAlias,
            ...(Object.keys(inputValues).length > 0 ? { inputValues } : {}),
        });
        const launchBody = (await launch.json().catch(() => undefined)) as
            | { runId?: string; code?: string; message?: string }
            | undefined;
        if (!launch.ok || !launchBody?.runId) {
            throw new Error(
                `launch refused: ${launchBody?.code ?? launch.status} ${launchBody?.message ?? ""}`.trim(),
            );
        }
        const hobbesRunId = launchBody.runId;
        emitRunbookEvent(context, "runbookStudio.runtime.launchPrepared", "ok", {
            hobbesRunIdDigest: metaField(hobbesRunId.length),
        });

        const confirm = await this.request(
            runtime.baseUrl,
            "POST",
            `/api/investigations/runs/${encodeURIComponent(hobbesRunId)}/confirm`,
        );
        if (!confirm.ok) {
            throw new Error(`confirm refused: HTTP ${confirm.status}`);
        }

        const poll: ActivePoll = { stop: false };
        this.polls.set(request.runId, poll);
        void this.pollRun(runtime.baseUrl, request, hobbesRunId, poll, observer);
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
                await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
            }
        } finally {
            this.polls.delete(request.runId);
            this.hobbesRunIds.delete(request.runId);
        }
    }

    private async request(
        baseUrl: string,
        method: "GET" | "POST",
        pathAndQuery: string,
        body?: unknown,
    ): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            return await fetch(`${baseUrl}${pathAndQuery}`, {
                method,
                signal: controller.signal,
                ...(body !== undefined
                    ? {
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify(body),
                      }
                    : {}),
            });
        } finally {
            clearTimeout(timer);
        }
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
