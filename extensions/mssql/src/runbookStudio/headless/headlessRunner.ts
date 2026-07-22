/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * No-VS-Code deterministic-preview runner. This is intentionally narrower
 * than the future production headless Activity Host: it executes the same
 * immutable lock through the effect-free FakeRuntimeAdapter and refuses to
 * imply that workspace, SQL, DacFx, or provider effects occurred.
 */

import { ACTIVITY_CATALOG, validateLockAgainstCatalog } from "../activities/activityCatalog";
import { buildEvidenceExport, EvidenceExportArtifact } from "../evidenceExport";
import { isArtifactParseFailure, parseRunbookArtifact } from "../runbookArtifact";
import { validateTargetBindings } from "../targetBindings";
import { FakeRuntimeAdapter } from "../runtime/fakeRuntimeAdapter";
import type { RuntimeBoundaryEvent, RuntimeEventObserver } from "../runtime/runtimeAdapterTypes";
import type {
    RbsEvidenceExportFormat,
    RunbookArtifactFile,
} from "../../sharedInterfaces/runbookStudio";
import {
    HeadlessApprovalProvider,
    HeadlessSecretProvider,
    resolveHeadlessParameters,
} from "./headlessExecutionProviders";

const RUN_TIMEOUT_MS = 30_000;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const EXPORT_FORMATS: RbsEvidenceExportFormat[] = ["json", "junit", "sarif", "markdown"];

export const HEADLESS_EXIT_CODES = {
    pass: 0,
    fail: 2,
    blocked: 3,
    invalid: 4,
    cancelled: 5,
    internal: 10,
} as const;

export type HeadlessOutcome = keyof typeof HEADLESS_EXIT_CODES;

export interface HeadlessValidationResult {
    valid: boolean;
    executable: boolean;
    mode: "deterministicPreview";
    runbookId?: string;
    planRevision?: string;
    planHash?: string;
    issues: Array<{
        kind: "artifact" | "parameter" | "catalog" | "target" | "capability" | "policy";
        code: string;
        nodeId?: string;
        parameterId?: string;
    }>;
    /** True when the lock contains activities that would mutate in the real
     * local lane. They remain synthetic here. */
    simulatedMutationCount: number;
}

export interface HeadlessPreviewOptions {
    artifactText: string;
    parameterValues?: Record<string, string | number | boolean | null>;
    runId?: string;
    deterministicPreviewAcknowledged: boolean;
    approvePreviewGates?: boolean;
    secretProvider?: HeadlessSecretProvider;
    approvalProvider?: HeadlessApprovalProvider;
    allowInlineSecrets?: boolean;
    cancellationSignal?: AbortSignal;
}

export interface HeadlessPreviewResult {
    schemaVersion: 1;
    mode: "deterministicPreview";
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
    internalStage?: "runtime" | "evidence" | "identity";
    nodeCounts?: { succeeded: number; failed: number; skipped: number; cancelled: number };
    evidenceAvailable: boolean;
    exports?: Partial<Record<RbsEvidenceExportFormat, EvidenceExportArtifact>>;
    validation: HeadlessValidationResult;
}

export function headlessCapabilities(): Record<string, unknown> {
    return {
        schemaVersion: 1,
        runtimeKind: "fake",
        mode: "deterministicPreview",
        modelRequired: false,
        effects: "none",
        approvalMode: "explicitPreviewAcknowledgement",
        executionProviderContracts: {
            secret: "environmentIndirection",
            approval: "runPlanGateDigestBoundManifest",
            machineOutput: "createNewAtomicSummaryLast",
        },
        evidenceFormats: [...EXPORT_FORMATS],
        activities: ACTIVITY_CATALOG.map((activity) => ({
            kind: activity.kind,
            version: activity.version,
            outputContract: activity.outputContract,
            simulatedOnly: true,
        })),
        productionHeadlessActivityHostAvailable: false,
        productionHeadlessActivitySubsetAvailable: true,
        productionHeadlessActivityKinds: [
            "workspace.inspect",
            "git.change-set.inspect",
            "ef.project.discover",
        ],
    };
}

export async function validateHeadlessPreview(
    artifactText: string,
    parameterValues: Record<string, string | number | boolean | null> = {},
    providers: {
        secretProvider?: HeadlessSecretProvider;
        allowInlineSecrets?: boolean;
    } = {},
): Promise<{
    artifact?: RunbookArtifactFile;
    values?: Record<string, string | number | boolean | null>;
    result: HeadlessValidationResult;
}> {
    const parsed = parseRunbookArtifact(artifactText);
    if (isArtifactParseFailure(parsed)) {
        return {
            result: {
                valid: false,
                executable: false,
                mode: "deterministicPreview",
                issues: [{ kind: "artifact", code: parsed.code }],
                simulatedMutationCount: 0,
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
                mode: "deterministicPreview",
                ...identity,
                issues: [{ kind: "capability", code: "RunbookStudio.NotCompiled" }],
                simulatedMutationCount: 0,
            },
        };
    }

    const issues: HeadlessValidationResult["issues"] = [];
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
    const adapter = new FakeRuntimeAdapter();
    try {
        const validation = await adapter.validate(artifact, headlessContext("validate"));
        for (const issue of validation.issues) {
            issues.push({
                kind: "capability",
                code: "HeadlessPreview.ActivityUnsupported",
                ...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
            });
        }
    } finally {
        await adapter.dispose();
    }
    const simulatedMutationCount = artifact.lock.nodes.filter(
        (node) => node.kind === "activity" && node.blastRadius?.reversibility !== "noEffect",
    ).length;
    return {
        artifact,
        values: bound.values,
        result: {
            valid: issues.every((issue) => issue.kind === "capability"),
            executable: issues.length === 0,
            mode: "deterministicPreview",
            ...identity,
            issues,
            simulatedMutationCount,
        },
    };
}

export async function runHeadlessPreview(
    options: HeadlessPreviewOptions,
): Promise<HeadlessPreviewResult> {
    const checked = await validateHeadlessPreview(
        options.artifactText,
        options.parameterValues ?? {},
        {
            ...(options.secretProvider ? { secretProvider: options.secretProvider } : {}),
            ...(options.allowInlineSecrets !== undefined
                ? { allowInlineSecrets: options.allowInlineSecrets }
                : {}),
        },
    );
    const base = {
        schemaVersion: 1 as const,
        mode: "deterministicPreview" as const,
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
            evidenceAvailable: false,
        };
    }
    if (!checked.result.executable || !checked.artifact || !checked.values) {
        return {
            ...base,
            outcome: "blocked",
            exitCode: HEADLESS_EXIT_CODES.blocked,
            evidenceAvailable: false,
        };
    }
    if (!options.deterministicPreviewAcknowledged) {
        return {
            ...base,
            outcome: "blocked",
            exitCode: HEADLESS_EXIT_CODES.blocked,
            evidenceAvailable: false,
            validation: {
                ...checked.result,
                executable: false,
                issues: checked.result.issues.concat({
                    kind: "policy",
                    code: "HeadlessPreview.AcknowledgementRequired",
                }),
            },
        };
    }
    const runId = options.runId ?? `run_${Date.now().toString(36)}`;
    if (!SAFE_RUN_ID.test(runId)) {
        return {
            ...base,
            outcome: "invalid",
            exitCode: HEADLESS_EXIT_CODES.invalid,
            evidenceAvailable: false,
            validation: {
                ...checked.result,
                valid: false,
                executable: false,
                issues: checked.result.issues.concat({
                    kind: "artifact",
                    code: "HeadlessPreview.RunIdInvalid",
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
            evidenceAvailable: false,
        };
    }

    const adapter = new FakeRuntimeAdapter();
    const context = headlessContext(runId);
    let cancellationRequested = false;
    const onCancellation = () => {
        cancellationRequested = true;
        void adapter.cancelRun(runId, context);
    };
    options.cancellationSignal?.addEventListener("abort", onCancellation, { once: true });
    let blockedGateId: string | undefined;
    let approvalPolicyDigest: string | undefined;
    let evidenceManifest: string | undefined;
    const events: RuntimeBoundaryEvent[] = [];
    const terminalPromise = new Promise<Extract<RuntimeBoundaryEvent, { kind: "terminal" }>>(
        (resolve, reject) => {
            const observer: RuntimeEventObserver = {
                onEvent: (event) => {
                    events.push(event);
                    if (
                        event.kind === "nodeState" &&
                        event.output?.contract === "evidenceBundle/1"
                    ) {
                        evidenceManifest = event.output.text;
                    }
                    if (event.kind === "gateRequested") {
                        queueMicrotask(() => {
                            void (async () => {
                                let approve = options.approvePreviewGates === true;
                                if (options.approvalProvider) {
                                    try {
                                        const decision = await options.approvalProvider.decide({
                                            runId,
                                            runbookId: checked.artifact!.id,
                                            planRevision: checked.artifact!.lock!.planRevision,
                                            planHash: checked.artifact!.lock!.planHash,
                                            gateId: event.nodeId,
                                        });
                                        approve = decision.approved;
                                        if (decision.approved && decision.policyDigest) {
                                            approvalPolicyDigest ??= decision.policyDigest;
                                        }
                                    } catch {
                                        approve = false;
                                    }
                                }
                                if (!approve) {
                                    blockedGateId ??= event.nodeId;
                                }
                                const accepted = await adapter.respondToGate(
                                    runId,
                                    event.nodeId,
                                    approve,
                                    context,
                                );
                                if (!accepted) {
                                    reject(new Error("preview gate was not pending"));
                                }
                            })().catch(reject);
                        });
                    }
                    if (event.kind === "terminal") {
                        resolve(event);
                    }
                },
                onGap: () => reject(new Error("deterministic preview dropped state")),
                onExit: () => reject(new Error("deterministic preview runtime exited")),
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
    let internalStage: HeadlessPreviewResult["internalStage"] = "runtime";
    try {
        const terminal = await Promise.race([
            terminalPromise,
            new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                    () => reject(new Error("deterministic preview timed out")),
                    RUN_TIMEOUT_MS,
                );
            }),
        ]);
        internalStage = "evidence";
        const evidenceExports = evidenceManifest
            ? Object.fromEntries(
                  EXPORT_FORMATS.map((format) => [
                      format,
                      buildEvidenceExport(evidenceManifest!, format),
                  ]),
              )
            : undefined;
        internalStage = "identity";
        if (evidenceExports) {
            const identity = evidenceExports.json.sourceIdentity;
            if (
                identity.runId !== runId ||
                identity.runbookId !== checked.artifact.id ||
                identity.planRevision !== checked.artifact.lock!.planRevision ||
                identity.planHash !== checked.artifact.lock!.planHash ||
                identity.verdict !== terminal.verdict
            ) {
                throw new Error("evidence identity mismatch");
            }
        }
        const nodeCounts = countNodeStates(events);
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
            nodeCounts,
            evidenceAvailable: evidenceExports !== undefined,
            ...(evidenceExports ? { exports: evidenceExports } : {}),
        };
    } catch {
        return {
            ...base,
            outcome: "internal",
            exitCode: HEADLESS_EXIT_CODES.internal,
            runId,
            evidenceAvailable: false,
            internalStage,
        };
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
        options.cancellationSignal?.removeEventListener("abort", onCancellation);
        await adapter.dispose();
    }
}

function countNodeStates(events: RuntimeBoundaryEvent[]): HeadlessPreviewResult["nodeCounts"] {
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
    return { traceId: "headless-preview", operationId };
}

function nodeIdFromDetail(detail: string): string | undefined {
    return /^node '([A-Za-z0-9_.:-]+)'/.exec(detail)?.[1];
}

function structuralIssueCode(detail: string): string {
    if (detail.includes("unregistered activity")) {
        return "HeadlessPreview.ActivityUnregistered";
    }
    if (detail.includes("missing required input")) {
        return "HeadlessPreview.InputRequired";
    }
    if (detail.includes("read-only SELECT")) {
        return "HeadlessPreview.SqlPolicyDenied";
    }
    if (detail.includes("target")) {
        return "HeadlessPreview.TargetInvalid";
    }
    return "HeadlessPreview.CatalogMismatch";
}
