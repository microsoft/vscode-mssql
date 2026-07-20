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
    RunbookParameterDefinition,
} from "../../sharedInterfaces/runbookStudio";

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
        evidenceFormats: [...EXPORT_FORMATS],
        activities: ACTIVITY_CATALOG.map((activity) => ({
            kind: activity.kind,
            version: activity.version,
            outputContract: activity.outputContract,
            simulatedOnly: true,
        })),
        productionHeadlessActivityHostAvailable: false,
    };
}

export async function validateHeadlessPreview(
    artifactText: string,
    parameterValues: Record<string, string | number | boolean | null> = {},
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
    const bound = bindHeadlessParameters(artifact.source.parameters, parameterValues);
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
                        const approve = options.approvePreviewGates === true;
                        if (!approve) {
                            blockedGateId ??= event.nodeId;
                        }
                        queueMicrotask(() => {
                            void adapter
                                .respondToGate(runId, event.nodeId, approve, context)
                                .then((accepted) => {
                                    if (!accepted) {
                                        reject(new Error("preview gate was not pending"));
                                    }
                                }, reject);
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

function bindHeadlessParameters(
    definitions: RunbookParameterDefinition[],
    provided: Record<string, string | number | boolean | null>,
): {
    values: Record<string, string | number | boolean | null>;
    issues: HeadlessValidationResult["issues"];
} {
    const values: Record<string, string | number | boolean | null> = {};
    const issues: HeadlessValidationResult["issues"] = [];
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    for (const parameterId of Object.keys(provided)) {
        if (!definitionsById.has(parameterId)) {
            issues.push({
                kind: "parameter",
                code: "HeadlessPreview.ParameterUnknown",
                parameterId,
            });
        }
    }
    for (const definition of definitions) {
        const raw = provided[definition.id];
        if (raw === undefined || raw === null || raw === "") {
            if (definition.default !== undefined) {
                values[definition.id] = definition.default;
            } else if (definition.required) {
                issues.push({
                    kind: "parameter",
                    code: "HeadlessPreview.ParameterRequired",
                    parameterId: definition.id,
                });
            }
            continue;
        }
        switch (definition.type) {
            case "int": {
                const parsed = typeof raw === "number" ? raw : Number(raw);
                if (!Number.isSafeInteger(parsed)) {
                    issues.push({
                        kind: "parameter",
                        code: "HeadlessPreview.ParameterIntegerRequired",
                        parameterId: definition.id,
                    });
                } else {
                    values[definition.id] = parsed;
                }
                break;
            }
            case "boolean":
                if (typeof raw !== "boolean" && raw !== "true" && raw !== "false") {
                    issues.push({
                        kind: "parameter",
                        code: "HeadlessPreview.ParameterBooleanRequired",
                        parameterId: definition.id,
                    });
                } else {
                    values[definition.id] = raw === true || raw === "true";
                }
                break;
            case "enum":
                if (typeof raw !== "string" || !(definition.enumValues ?? []).includes(raw)) {
                    issues.push({
                        kind: "parameter",
                        code: "HeadlessPreview.ParameterEnumRequired",
                        parameterId: definition.id,
                    });
                } else {
                    values[definition.id] = raw;
                }
                break;
            default:
                if (typeof raw !== "string") {
                    issues.push({
                        kind: "parameter",
                        code: "HeadlessPreview.ParameterStringRequired",
                        parameterId: definition.id,
                    });
                } else {
                    values[definition.id] = raw;
                }
                break;
        }
    }
    return { values, issues };
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
