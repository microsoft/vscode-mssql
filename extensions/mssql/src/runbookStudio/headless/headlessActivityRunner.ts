/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * No-VS-Code production activity runner. The first deliberately closed slice
 * executes a real, read-only Git change-set capture. Unsupported activities
 * are blocked at admission; this host never falls through to deterministic
 * preview behavior for an activity node.
 */

import { ACTIVITY_CATALOG, validateLockAgainstCatalog } from "../activities/activityCatalog";
import { isArtifactParseFailure, parseRunbookArtifact } from "../runbookArtifact";
import { ActivityExecutionDelegate, FakeRuntimeAdapter } from "../runtime/fakeRuntimeAdapter";
import type {
    RuntimeBoundaryEvent,
    RuntimeEventObserver,
    RuntimeOutputPayload,
} from "../runtime/runtimeAdapterTypes";
import type { RunbookArtifactFile } from "../../sharedInterfaces/runbookStudio";
import { validateTargetBindings } from "../targetBindings";
import {
    HeadlessApprovalProvider,
    HeadlessSecretProvider,
    resolveHeadlessParameters,
} from "./headlessExecutionProviders";
import { HeadlessWorkspaceActivityDelegate } from "./headlessWorkspaceActivity";
import { HEADLESS_EXIT_CODES, HeadlessOutcome } from "./headlessRunner";

const RUN_TIMEOUT_MS = 10 * 60_000;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export const PRODUCTION_HEADLESS_ACTIVITY_KINDS = [
    "workspace.inspect",
    "git.change-set.inspect",
    "ef.project.discover",
] as const;

export interface HeadlessActivityValidationResult {
    valid: boolean;
    executable: boolean;
    mode: "productionActivityHost";
    runbookId?: string;
    planRevision?: string;
    planHash?: string;
    issues: Array<{
        kind: "artifact" | "parameter" | "catalog" | "target" | "capability";
        code: string;
        nodeId?: string;
        parameterId?: string;
    }>;
    realActivityCount: number;
}

export interface HeadlessActivityOptions {
    artifactText: string;
    trustedWorkspaceRoot: string;
    activityArtifactRoot: string;
    parameterValues?: Record<string, string | number | boolean | null>;
    runId?: string;
    secretProvider?: HeadlessSecretProvider;
    approvalProvider?: HeadlessApprovalProvider;
    allowInlineSecrets?: boolean;
    cancellationSignal?: AbortSignal;
}

export interface HeadlessActivityResult {
    schemaVersion: 1;
    mode: "productionActivityHost";
    effects: "real";
    outcome: HeadlessOutcome;
    exitCode: number;
    runId?: string;
    runbookId?: string;
    planRevision?: string;
    planHash?: string;
    terminalState?: "succeeded" | "failed" | "cancelled";
    verdict?: "pass" | "fail" | "indeterminate";
    blockedGateId?: string;
    approvalPolicyDigest?: string;
    nodeCounts?: { succeeded: number; failed: number; skipped: number; cancelled: number };
    outputs?: Record<string, RuntimeOutputPayload>;
    validation: HeadlessActivityValidationResult;
}

export function productionHeadlessActivityCapabilities(): Record<string, unknown> {
    return {
        schemaVersion: 1,
        mode: "productionActivityHost",
        runtimeKind: "local",
        modelRequired: false,
        effects: "real",
        activities: ACTIVITY_CATALOG.filter((activity) =>
            (PRODUCTION_HEADLESS_ACTIVITY_KINDS as readonly string[]).includes(activity.kind),
        ).map((activity) => ({
            kind: activity.kind,
            version: activity.version,
            outputContract: activity.outputContract,
        })),
        unsupportedActivityPolicy: "blockAtAdmission",
        workspacePolicy: "realpathContained",
        artifactPolicy: "boundedCreateNew",
        productionHeadlessActivityHostAvailable: false,
        productionHeadlessActivitySubsetAvailable: true,
    };
}

export async function validateHeadlessActivities(
    artifactText: string,
    parameterValues: Record<string, string | number | boolean | null> = {},
    providers: {
        secretProvider?: HeadlessSecretProvider;
        allowInlineSecrets?: boolean;
    } = {},
    delegate: ActivityExecutionDelegate = admissionDelegate(),
): Promise<{
    artifact?: RunbookArtifactFile;
    values?: Record<string, string | number | boolean | null>;
    result: HeadlessActivityValidationResult;
}> {
    const parsed = parseRunbookArtifact(artifactText);
    if (isArtifactParseFailure(parsed)) {
        return {
            result: {
                valid: false,
                executable: false,
                mode: "productionActivityHost",
                issues: [{ kind: "artifact", code: parsed.code }],
                realActivityCount: 0,
            },
        };
    }
    const artifact = parsed.artifact;
    const identity = {
        runbookId: artifact.id,
        ...(artifact.lock?.planRevision ? { planRevision: artifact.lock.planRevision } : {}),
        ...(artifact.lock?.planHash ? { planHash: artifact.lock.planHash } : {}),
    };
    if (!artifact.lock) {
        return {
            artifact,
            result: {
                valid: true,
                executable: false,
                mode: "productionActivityHost",
                ...identity,
                issues: [{ kind: "capability", code: "RunbookStudio.NotCompiled" }],
                realActivityCount: 0,
            },
        };
    }

    const issues: HeadlessActivityValidationResult["issues"] = [];
    for (const detail of validateLockAgainstCatalog(artifact.lock)) {
        issues.push({
            kind: "catalog",
            code: structuralIssueCode(detail),
            ...(nodeIdFromDetail(detail) ? { nodeId: nodeIdFromDetail(detail) } : {}),
        });
    }
    const bound = await resolveHeadlessParameters(artifact.source.parameters, parameterValues, {
        allowInlineSecrets: providers.allowInlineSecrets ?? true,
        ...(providers.secretProvider ? { secretProvider: providers.secretProvider } : {}),
    });
    issues.push(...bound.issues);
    if (bound.issues.length === 0) {
        for (const issue of validateTargetBindings(artifact, bound.values)) {
            issues.push({
                kind: "target",
                code: issue.kind,
                ...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
            });
        }
    }
    for (const node of artifact.lock.nodes) {
        if (
            node.kind === "activity" &&
            delegate.supportedActivityKinds?.has(node.activityKind ?? "") !== true
        ) {
            issues.push({
                kind: "capability",
                code: "HeadlessActivity.ActivityUnsupported",
                nodeId: node.id,
            });
        }
    }
    const realActivityCount = artifact.lock.nodes.filter(
        (node) =>
            node.kind === "activity" &&
            delegate.supportedActivityKinds?.has(node.activityKind ?? "") === true,
    ).length;
    return {
        artifact,
        values: bound.values,
        result: {
            valid: issues.every((issue) => issue.kind === "capability"),
            executable: issues.length === 0 && realActivityCount > 0,
            mode: "productionActivityHost",
            ...identity,
            issues,
            realActivityCount,
        },
    };
}

export async function runHeadlessActivities(
    options: HeadlessActivityOptions,
): Promise<HeadlessActivityResult> {
    const delegate = new HeadlessWorkspaceActivityDelegate(
        options.trustedWorkspaceRoot,
        options.activityArtifactRoot,
    );
    const checked = await validateHeadlessActivities(
        options.artifactText,
        options.parameterValues ?? {},
        {
            ...(options.secretProvider ? { secretProvider: options.secretProvider } : {}),
            ...(options.allowInlineSecrets !== undefined
                ? { allowInlineSecrets: options.allowInlineSecrets }
                : {}),
        },
        delegate,
    );
    const base = {
        schemaVersion: 1 as const,
        mode: "productionActivityHost" as const,
        effects: "real" as const,
        ...(checked.result.runbookId ? { runbookId: checked.result.runbookId } : {}),
        ...(checked.result.planRevision ? { planRevision: checked.result.planRevision } : {}),
        ...(checked.result.planHash ? { planHash: checked.result.planHash } : {}),
        validation: checked.result,
    };
    if (!checked.result.valid) {
        return {
            ...base,
            outcome: "invalid",
            exitCode: HEADLESS_EXIT_CODES.invalid,
        };
    }
    if (!checked.result.executable || !checked.artifact || !checked.values) {
        return {
            ...base,
            outcome: "blocked",
            exitCode: HEADLESS_EXIT_CODES.blocked,
        };
    }
    const runId = options.runId ?? `run_${Date.now().toString(36)}`;
    if (!SAFE_RUN_ID.test(runId)) {
        return {
            ...base,
            outcome: "invalid",
            exitCode: HEADLESS_EXIT_CODES.invalid,
            validation: {
                ...checked.result,
                valid: false,
                executable: false,
                issues: checked.result.issues.concat({
                    kind: "artifact",
                    code: "HeadlessActivity.RunIdInvalid",
                }),
            },
        };
    }
    if (options.cancellationSignal?.aborted) {
        return {
            ...base,
            outcome: "cancelled",
            exitCode: HEADLESS_EXIT_CODES.cancelled,
            runId,
        };
    }

    const adapter = new FakeRuntimeAdapter(delegate);
    const context = headlessContext(runId);
    const events: RuntimeBoundaryEvent[] = [];
    const outputs: Record<string, RuntimeOutputPayload> = {};
    let cancellationRequested = false;
    let blockedGateId: string | undefined;
    let approvalPolicyDigest: string | undefined;
    const onCancellation = () => {
        cancellationRequested = true;
        void adapter.cancelRun(runId, context);
    };
    options.cancellationSignal?.addEventListener("abort", onCancellation, { once: true });
    const terminalPromise = new Promise<Extract<RuntimeBoundaryEvent, { kind: "terminal" }>>(
        (resolve, reject) => {
            const observer: RuntimeEventObserver = {
                onEvent: (event) => {
                    events.push(event);
                    if (event.kind === "nodeState" && event.output) {
                        outputs[event.nodeId] = event.output;
                    }
                    if (event.kind === "gateRequested") {
                        queueMicrotask(() => {
                            void (async () => {
                                let approved = false;
                                if (options.approvalProvider) {
                                    try {
                                        const decision = await options.approvalProvider.decide({
                                            runId,
                                            runbookId: checked.artifact!.id,
                                            planRevision: checked.artifact!.lock!.planRevision,
                                            planHash: checked.artifact!.lock!.planHash,
                                            gateId: event.nodeId,
                                        });
                                        approved = decision.approved;
                                        if (approved && decision.policyDigest) {
                                            approvalPolicyDigest ??= decision.policyDigest;
                                        }
                                    } catch {
                                        approved = false;
                                    }
                                }
                                if (!approved) {
                                    blockedGateId ??= event.nodeId;
                                }
                                const accepted = await adapter.respondToGate(
                                    runId,
                                    event.nodeId,
                                    approved,
                                    context,
                                );
                                if (!accepted) {
                                    reject(new Error("activity gate was not pending"));
                                }
                            })().catch(reject);
                        });
                    }
                    if (event.kind === "terminal") {
                        resolve(event);
                    }
                },
                onGap: () => reject(new Error("headless activity host dropped state")),
                onExit: () => reject(new Error("headless activity host exited")),
            };
            void adapter
                .startRun(
                    { runId, artifact: checked.artifact!, parameterValues: checked.values! },
                    observer,
                    context,
                )
                .catch(reject);
        },
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const terminal = await Promise.race([
            terminalPromise,
            new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                    () => reject(new Error("headless activity run timed out")),
                    RUN_TIMEOUT_MS,
                );
            }),
        ]);
        const outcome: HeadlessOutcome =
            cancellationRequested || terminal.state === "cancelled"
                ? "cancelled"
                : blockedGateId
                  ? "blocked"
                  : terminal.state === "failed" || terminal.verdict === "fail"
                    ? "fail"
                    : "pass";
        return {
            ...base,
            outcome,
            exitCode: HEADLESS_EXIT_CODES[outcome],
            runId,
            terminalState: terminal.state,
            ...(terminal.verdict ? { verdict: terminal.verdict } : {}),
            ...(blockedGateId ? { blockedGateId } : {}),
            ...(approvalPolicyDigest ? { approvalPolicyDigest } : {}),
            nodeCounts: countNodeStates(events),
            outputs,
        };
    } catch {
        return {
            ...base,
            outcome: "internal",
            exitCode: HEADLESS_EXIT_CODES.internal,
            runId,
        };
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
        options.cancellationSignal?.removeEventListener("abort", onCancellation);
        await adapter.dispose();
    }
}

function admissionDelegate(): ActivityExecutionDelegate {
    return {
        runtimeKind: "local",
        supportedActivityKinds: new Set(PRODUCTION_HEADLESS_ACTIVITY_KINDS),
        executeActivity: () => Promise.resolve(undefined),
    };
}

function countNodeStates(events: RuntimeBoundaryEvent[]): HeadlessActivityResult["nodeCounts"] {
    const finalStates = new Map<string, string>();
    for (const event of events) {
        if (event.kind === "nodeState") {
            finalStates.set(event.nodeId, event.state);
        }
    }
    return {
        succeeded: [...finalStates.values()].filter((state) => state === "succeeded").length,
        failed: [...finalStates.values()].filter((state) => state === "failed").length,
        skipped: [...finalStates.values()].filter((state) => state === "skipped").length,
        cancelled: [...finalStates.values()].filter((state) => state === "cancelled").length,
    };
}

function headlessContext(operationId: string) {
    return { traceId: "headless-activity", operationId };
}

function nodeIdFromDetail(detail: string): string | undefined {
    return /^node '([A-Za-z0-9_.:-]+)'/.exec(detail)?.[1];
}

function structuralIssueCode(detail: string): string {
    if (detail.includes("unregistered activity")) {
        return "HeadlessActivity.ActivityUnregistered";
    }
    if (detail.includes("missing required input")) {
        return "HeadlessActivity.InputRequired";
    }
    if (detail.includes("target")) {
        return "HeadlessActivity.TargetInvalid";
    }
    return "HeadlessActivity.CatalogMismatch";
}
