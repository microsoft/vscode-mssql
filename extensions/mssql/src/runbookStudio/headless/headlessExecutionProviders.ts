/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { digestRunbookValue } from "../runbookDigest";
import type { RunbookParameterDefinition } from "../../sharedInterfaces/runbookStudio";

const PARAMETER_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const GATE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const PLAN_HASH = /^sha256:[a-f0-9]{64}$/i;
const MAX_SECRET_LENGTH = 64 * 1024;
const MAX_APPROVAL_GATES = 256;
const MAX_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface HeadlessParameterIssue {
    kind: "parameter";
    code: string;
    parameterId?: string;
}

export interface HeadlessSecretProvider {
    readonly kind: string;
    validateParameters?(definitions: RunbookParameterDefinition[]): HeadlessParameterIssue[];
    resolveSecret(parameter: RunbookParameterDefinition): Promise<string | undefined>;
}

export class HeadlessProviderConfigurationError extends Error {
    constructor(public readonly code: string) {
        super(code);
        this.name = "HeadlessProviderConfigurationError";
    }
}

/** Runtime environment indirection: the mapping is non-secret and the
 * environment value is read only for one declared secret parameter. */
export class EnvironmentHeadlessSecretProvider implements HeadlessSecretProvider {
    public readonly kind = "environment";
    private readonly mapping: Readonly<Record<string, string>>;

    constructor(
        mapping: Readonly<Record<string, string>>,
        private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
    ) {
        const normalized: Record<string, string> = {};
        const environmentNames = new Set<string>();
        for (const [parameterId, environmentName] of Object.entries(mapping)) {
            if (
                !PARAMETER_ID.test(parameterId) ||
                !ENVIRONMENT_NAME.test(environmentName) ||
                environmentNames.has(environmentName)
            ) {
                throw new HeadlessProviderConfigurationError(
                    "HeadlessActivityHost.SecretMappingInvalid",
                );
            }
            environmentNames.add(environmentName);
            normalized[parameterId] = environmentName;
        }
        this.mapping = Object.freeze(normalized);
    }

    public resolveSecret(parameter: RunbookParameterDefinition): Promise<string | undefined> {
        if (parameter.type !== "secret" || !PARAMETER_ID.test(parameter.id)) {
            return Promise.resolve(undefined);
        }
        const environmentName = this.mapping[parameter.id];
        if (!environmentName) {
            return Promise.resolve(undefined);
        }
        const value = this.environment[environmentName];
        if (typeof value !== "string" || value.length === 0 || value.length > MAX_SECRET_LENGTH) {
            return Promise.resolve(undefined);
        }
        return Promise.resolve(value);
    }

    public validateParameters(definitions: RunbookParameterDefinition[]): HeadlessParameterIssue[] {
        const secrets = new Set(
            definitions
                .filter((definition) => definition.type === "secret")
                .map((definition) => definition.id),
        );
        return Object.keys(this.mapping)
            .filter((parameterId) => !secrets.has(parameterId))
            .map((parameterId) => ({
                kind: "parameter" as const,
                code: "HeadlessActivityHost.SecretMappingUnknown",
                parameterId,
            }));
    }
}

export async function resolveHeadlessParameters(
    definitions: RunbookParameterDefinition[],
    provided: Record<string, string | number | boolean | null>,
    options: {
        allowInlineSecrets: boolean;
        secretProvider?: HeadlessSecretProvider;
    },
): Promise<{
    values: Record<string, string | number | boolean | null>;
    issues: HeadlessParameterIssue[];
}> {
    const values: Record<string, string | number | boolean | null> = {};
    const issues: HeadlessParameterIssue[] = [];
    issues.push(...(options.secretProvider?.validateParameters?.(definitions) ?? []));
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
        if (definition.type === "secret") {
            if (raw !== undefined && raw !== null && raw !== "") {
                if (!options.allowInlineSecrets) {
                    issues.push({
                        kind: "parameter",
                        code: "HeadlessActivityHost.InlineSecretDenied",
                        parameterId: definition.id,
                    });
                } else if (typeof raw !== "string") {
                    issues.push({
                        kind: "parameter",
                        code: "HeadlessPreview.ParameterStringRequired",
                        parameterId: definition.id,
                    });
                } else {
                    values[definition.id] = raw;
                }
                continue;
            }
            let secret: string | undefined;
            try {
                secret = await options.secretProvider?.resolveSecret(definition);
            } catch {
                secret = undefined;
            }
            if (secret !== undefined) {
                values[definition.id] = secret;
            } else if (definition.required) {
                issues.push({
                    kind: "parameter",
                    code: options.secretProvider
                        ? "HeadlessActivityHost.SecretUnavailable"
                        : "HeadlessPreview.ParameterRequired",
                    parameterId: definition.id,
                });
            }
            continue;
        }
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

export interface HeadlessApprovalManifest {
    schemaVersion: 1;
    runId: string;
    runbookId: string;
    planRevision: string;
    planHash: string;
    approvedGateIds: string[];
    expiresEpochMs: number;
}

export interface HeadlessApprovalChallenge {
    runId: string;
    runbookId: string;
    planRevision: string;
    planHash: string;
    gateId: string;
}

export interface HeadlessApprovalDecision {
    approved: boolean;
    providerKind: string;
    policyDigest?: string;
}

export interface HeadlessApprovalProvider {
    readonly kind: string;
    decide(challenge: HeadlessApprovalChallenge): Promise<HeadlessApprovalDecision>;
}

export class ManifestHeadlessApprovalProvider implements HeadlessApprovalProvider {
    public readonly kind = "digestBoundManifest";
    public readonly policyDigest: string;
    private readonly approvedGateIds: ReadonlySet<string>;

    constructor(
        private readonly manifest: HeadlessApprovalManifest,
        now = Date.now(),
    ) {
        validateApprovalManifest(manifest, now);
        this.approvedGateIds = new Set(manifest.approvedGateIds);
        this.policyDigest = digestRunbookValue(manifest);
    }

    public decide(challenge: HeadlessApprovalChallenge): Promise<HeadlessApprovalDecision> {
        const approved =
            challenge.runId === this.manifest.runId &&
            challenge.runbookId === this.manifest.runbookId &&
            challenge.planRevision === this.manifest.planRevision &&
            challenge.planHash === this.manifest.planHash &&
            this.approvedGateIds.has(challenge.gateId) &&
            Date.now() <= this.manifest.expiresEpochMs;
        return Promise.resolve({
            approved,
            providerKind: this.kind,
            ...(approved ? { policyDigest: this.policyDigest } : {}),
        });
    }
}

function validateApprovalManifest(manifest: HeadlessApprovalManifest, now: number): void {
    const keys = Object.keys(manifest).sort();
    const expected = [
        "approvedGateIds",
        "expiresEpochMs",
        "planHash",
        "planRevision",
        "runId",
        "runbookId",
        "schemaVersion",
    ];
    if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index]) ||
        manifest.schemaVersion !== 1 ||
        !RUN_ID.test(manifest.runId) ||
        !ARTIFACT_ID.test(manifest.runbookId) ||
        !ARTIFACT_ID.test(manifest.planRevision) ||
        !PLAN_HASH.test(manifest.planHash) ||
        !Array.isArray(manifest.approvedGateIds) ||
        manifest.approvedGateIds.length > MAX_APPROVAL_GATES ||
        manifest.approvedGateIds.some((gateId) => !GATE_ID.test(gateId)) ||
        new Set(manifest.approvedGateIds).size !== manifest.approvedGateIds.length ||
        !Number.isSafeInteger(manifest.expiresEpochMs) ||
        manifest.expiresEpochMs < now ||
        manifest.expiresEpochMs > now + MAX_APPROVAL_TTL_MS
    ) {
        throw new HeadlessProviderConfigurationError(
            "HeadlessActivityHost.ApprovalManifestInvalid",
        );
    }
}
