/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure runbook-artifact logic: parse, validate, canonicalize, hash (ADR-4).
 * No vscode imports — unit-testable and reusable by a future headless host.
 * Canonical serialization: ordinal-sorted keys, 2-space indent, LF, trailing
 * newline. The content hash covers ONLY source+lock (presentation and
 * cosmetic fields never invalidate a compiled plan).
 */

import * as crypto from "crypto";
import {
    CompiledRunbookLock,
    RunbookArtifactFile,
    RunbookParameterType,
    RunbookStudioErrorCode,
    RUNBOOK_LOCK_SCHEMA_VERSION,
    RUNBOOK_DESIGN_SCHEMA_VERSION,
    RUNBOOK_REQUIREMENTS_SCHEMA_VERSION,
    RUNBOOK_SOURCE_SCHEMA_VERSION,
} from "../sharedInterfaces/runbookStudio";

export interface ArtifactParseFailure {
    ok: false;
    code: RunbookStudioErrorCode;
    /** Non-localized diagnostic detail (safe: structural facts only). */
    detail: string;
}

export interface ArtifactParseSuccess {
    ok: true;
    artifact: RunbookArtifactFile;
}

export type ArtifactParseResult = ArtifactParseSuccess | ArtifactParseFailure;

/** Narrowing helper — the extension tsconfig is non-strict, where boolean
 *  literal discriminants do not narrow; a type predicate always does. */
export function isArtifactParseFailure(
    result: ArtifactParseResult,
): result is ArtifactParseFailure {
    return !result.ok;
}

const PARAMETER_TYPES: ReadonlySet<string> = new Set<RunbookParameterType>([
    "string",
    "int",
    "boolean",
    "enum",
    "connection",
    "database",
    "secret",
]);

const NODE_KINDS: ReadonlySet<string> = new Set(["activity", "gate", "report"]);
const EDGE_WHEN: ReadonlySet<string> = new Set(["success", "failure", "approved", "rejected"]);
const TARGET_KINDS: ReadonlySet<string> = new Set([
    "workspace",
    "databaseProject",
    "dacpac",
    "sqlDatabase",
    "ephemeralSqlDatabase",
    "ciAgent",
]);
const TARGET_ENVIRONMENTS: ReadonlySet<string> = new Set([
    "local",
    "ephemeral",
    "ci",
    "development",
    "test",
    "staging",
    "approvedReadOnlyProduction",
]);
const REQUIREMENT_HOSTS: ReadonlySet<string> = new Set(["extension", "hobbes", "headless"]);
const REQUIREMENT_EFFECTS: ReadonlySet<string> = new Set(["read", "mutate"]);
const CONNECTION_REQUIREMENTS: ReadonlySet<string> = new Set(["none", "required", "provisioned"]);
const SECRET_REQUIREMENTS: ReadonlySet<string> = new Set(["none", "requiredAtRunTime"]);
const ROLLBACK_CONTRACTS: ReadonlySet<string> = new Set(["none", "automatic", "required"]);
const PROVIDER_REQUIREMENTS: ReadonlySet<string> = new Set(["none", "planning", "execution"]);

/** Hard input bounds — repository artifacts are untrusted (A1 §12). */
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 500;
const MAX_EDGES = 2000;
const MAX_PARAMETERS = 200;
const MAX_DESIGN_STEPS = 500;

function fail(code: RunbookStudioErrorCode, detail: string): ArtifactParseFailure {
    return { ok: false, code, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function runtimeSemanticsShapeError(value: unknown, nodeId: string): string | undefined {
    if (!isRecord(value) || !isNonEmptyString(value.nodeType)) {
        return `node '${nodeId}' runtime semantics invalid`;
    }
    if (value.role !== undefined && !isNonEmptyString(value.role)) {
        return `node '${nodeId}' runtime role invalid`;
    }
    if (value.description !== undefined && !isNonEmptyString(value.description)) {
        return `node '${nodeId}' runtime description invalid`;
    }
    if (value.decision !== undefined) {
        if (!isRecord(value.decision) || !Array.isArray(value.decision.branches)) {
            return `node '${nodeId}' runtime decision invalid`;
        }
        if (value.decision.branches.length === 0 || value.decision.branches.length > MAX_NODES) {
            return `node '${nodeId}' runtime decision branches invalid`;
        }
        for (const branch of value.decision.branches) {
            if (
                !isRecord(branch) ||
                !isNonEmptyString(branch.label) ||
                !Array.isArray(branch.targetNodeIds) ||
                branch.targetNodeIds.length === 0 ||
                branch.targetNodeIds.length > MAX_NODES ||
                !branch.targetNodeIds.every(isNonEmptyString)
            ) {
                return `node '${nodeId}' runtime decision branch invalid`;
            }
            if (branch.branchKey !== undefined && !isNonEmptyString(branch.branchKey)) {
                return `node '${nodeId}' runtime decision branch key invalid`;
            }
            if (branch.expression !== undefined && !isNonEmptyString(branch.expression)) {
                return `node '${nodeId}' runtime decision expression invalid`;
            }
        }
        if (
            value.decision.defaultTargetNodeId !== undefined &&
            !isNonEmptyString(value.decision.defaultTargetNodeId)
        ) {
            return `node '${nodeId}' runtime decision default invalid`;
        }
    }
    if (value.parallel !== undefined) {
        if (
            !isRecord(value.parallel) ||
            !Array.isArray(value.parallel.branchNodeIds) ||
            value.parallel.branchNodeIds.length === 0 ||
            value.parallel.branchNodeIds.length > MAX_NODES ||
            !value.parallel.branchNodeIds.every(isNonEmptyString)
        ) {
            return `node '${nodeId}' runtime parallel branches invalid`;
        }
        if (
            value.parallel.fanInTargetNodeId !== undefined &&
            !isNonEmptyString(value.parallel.fanInTargetNodeId)
        ) {
            return `node '${nodeId}' runtime parallel join invalid`;
        }
    }
    if (value.approval !== undefined) {
        if (
            !isRecord(value.approval) ||
            !isNonEmptyString(value.approval.reason) ||
            !isNonEmptyString(value.approval.approvalKind) ||
            !isNonEmptyString(value.approval.onApprove) ||
            (value.approval.onReject !== undefined && !isNonEmptyString(value.approval.onReject))
        ) {
            return `node '${nodeId}' runtime approval invalid`;
        }
    }
    return undefined;
}

export function parseRunbookArtifact(text: string): ArtifactParseResult {
    if (Buffer.byteLength(text, "utf8") > MAX_ARTIFACT_BYTES) {
        return fail("RunbookStudio.InvalidArtifact", "artifact exceeds size limit");
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return fail("RunbookStudio.InvalidArtifact", "not valid JSON");
    }
    if (!isRecord(raw)) {
        return fail("RunbookStudio.InvalidArtifact", "root is not an object");
    }
    if (typeof raw.schemaVersion !== "number") {
        return fail("RunbookStudio.InvalidArtifact", "missing schemaVersion");
    }
    if (raw.schemaVersion > 1) {
        // Newer artifact than this build understands: refuse, never munge.
        return fail(
            "RunbookStudio.IncompatibleVersion",
            `artifact schemaVersion ${raw.schemaVersion} > supported 1`,
        );
    }
    if (!isNonEmptyString(raw.id)) {
        return fail("RunbookStudio.InvalidArtifact", "missing id");
    }
    if (!isNonEmptyString(raw.name)) {
        return fail("RunbookStudio.InvalidArtifact", "missing name");
    }
    if (
        raw.family !== undefined &&
        raw.family !== "build" &&
        raw.family !== "validate" &&
        raw.family !== "investigate" &&
        raw.family !== "composed"
    ) {
        return fail("RunbookStudio.InvalidArtifact", "unknown family");
    }

    const source = raw.source;
    if (!isRecord(source)) {
        return fail("RunbookStudio.InvalidArtifact", "missing source");
    }
    if (source.schemaVersion !== RUNBOOK_SOURCE_SCHEMA_VERSION) {
        if (typeof source.schemaVersion === "number" && source.schemaVersion > 1) {
            return fail(
                "RunbookStudio.IncompatibleVersion",
                `source schemaVersion ${source.schemaVersion} > supported 1`,
            );
        }
        return fail("RunbookStudio.InvalidArtifact", "source schemaVersion invalid");
    }
    if (typeof source.intent !== "string") {
        return fail("RunbookStudio.InvalidArtifact", "source.intent missing");
    }
    if (!Array.isArray(source.parameters)) {
        return fail("RunbookStudio.InvalidArtifact", "source.parameters missing");
    }
    if (source.parameters.length > MAX_PARAMETERS) {
        return fail("RunbookStudio.InvalidArtifact", "too many parameters");
    }
    const parameterIds = new Set<string>();
    for (const parameter of source.parameters as unknown[]) {
        const failure = validateParameter(parameter, parameterIds);
        if (failure) {
            return failure;
        }
    }
    if (source.requirements !== undefined) {
        const failure = validateRequirements(source.requirements);
        if (failure) {
            return failure;
        }
    }
    if (source.design !== undefined) {
        const failure = validateDesign(source.design, source.requirements, raw.family);
        if (failure) {
            return failure;
        }
    }

    if (source.design !== undefined && raw.lock !== undefined) {
        return fail(
            "RunbookStudio.InvalidArtifact",
            "design-only artifact must not contain a lock",
        );
    }
    if (raw.lock !== undefined) {
        const failure = validateLock(raw.lock);
        if (failure) {
            return failure;
        }
    }

    return { ok: true, artifact: raw as unknown as RunbookArtifactFile };
}

function validateDesign(
    design: unknown,
    requirements: unknown,
    artifactFamily: unknown,
): ArtifactParseFailure | undefined {
    if (!isRecord(design)) {
        return fail("RunbookStudio.InvalidArtifact", "source.design is not an object");
    }
    if (design.schemaVersion !== RUNBOOK_DESIGN_SCHEMA_VERSION) {
        if (
            typeof design.schemaVersion === "number" &&
            design.schemaVersion > RUNBOOK_DESIGN_SCHEMA_VERSION
        ) {
            return fail(
                "RunbookStudio.IncompatibleVersion",
                `design schemaVersion ${design.schemaVersion} > supported ${RUNBOOK_DESIGN_SCHEMA_VERSION}`,
            );
        }
        return fail("RunbookStudio.InvalidArtifact", "design schemaVersion invalid");
    }
    if (
        (design.family !== "build" &&
            design.family !== "validate" &&
            design.family !== "investigate" &&
            design.family !== "composed") ||
        design.family !== artifactFamily
    ) {
        return fail("RunbookStudio.InvalidArtifact", "design family does not match artifact");
    }
    if (!Array.isArray(design.steps) || design.steps.length === 0) {
        return fail("RunbookStudio.InvalidArtifact", "design has no steps");
    }
    if (design.steps.length > MAX_DESIGN_STEPS) {
        return fail("RunbookStudio.InvalidArtifact", "design exceeds step limit");
    }
    const requirementVersions = new Map<string, number>();
    if (isRecord(requirements) && Array.isArray(requirements.activities)) {
        for (const requirement of requirements.activities) {
            if (
                isRecord(requirement) &&
                typeof requirement.kind === "string" &&
                typeof requirement.version === "number"
            ) {
                requirementVersions.set(requirement.kind, requirement.version);
            }
        }
    }
    const stepIds = new Set<string>();
    const stepKinds = new Set<string>();
    for (const step of design.steps as unknown[]) {
        if (!isRecord(step) || !isNonEmptyString(step.id)) {
            return fail("RunbookStudio.InvalidArtifact", "design step missing id");
        }
        if (stepIds.has(step.id)) {
            return fail("RunbookStudio.InvalidArtifact", `duplicate design step '${step.id}'`);
        }
        stepIds.add(step.id);
        if (
            !isNonEmptyString(step.label) ||
            !isNonEmptyString(step.description) ||
            !isNonEmptyString(step.activityKind) ||
            !Number.isInteger(step.activityVersion) ||
            (step.activityVersion as number) < 1 ||
            typeof step.targetKind !== "string" ||
            !TARGET_KINDS.has(step.targetKind) ||
            !Array.isArray(step.dependsOn) ||
            !step.dependsOn.every(isNonEmptyString)
        ) {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `design step '${step.id}' has invalid metadata`,
            );
        }
        if (requirementVersions.get(step.activityKind) !== step.activityVersion) {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `design step '${step.id}' does not match requirements`,
            );
        }
        if (stepKinds.has(step.activityKind)) {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `design contains duplicate activity '${step.activityKind}'`,
            );
        }
        stepKinds.add(step.activityKind);
    }
    if (
        stepKinds.size !== requirementVersions.size ||
        [...requirementVersions.keys()].some((kind) => !stepKinds.has(kind))
    ) {
        return fail("RunbookStudio.InvalidArtifact", "design does not cover requirements");
    }
    const priorIds = new Set<string>();
    for (const step of design.steps as Array<Record<string, unknown>>) {
        if (
            (step.dependsOn as string[]).some(
                (dependency) => dependency === step.id || !priorIds.has(dependency),
            )
        ) {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `design step '${step.id}' has an invalid dependency`,
            );
        }
        priorIds.add(step.id as string);
    }
    return undefined;
}

function validateRequirements(requirements: unknown): ArtifactParseFailure | undefined {
    if (!isRecord(requirements)) {
        return fail("RunbookStudio.InvalidArtifact", "source.requirements is not an object");
    }
    if (requirements.schemaVersion !== RUNBOOK_REQUIREMENTS_SCHEMA_VERSION) {
        if (
            typeof requirements.schemaVersion === "number" &&
            requirements.schemaVersion > RUNBOOK_REQUIREMENTS_SCHEMA_VERSION
        ) {
            return fail(
                "RunbookStudio.IncompatibleVersion",
                `requirements schemaVersion ${requirements.schemaVersion} > supported ${RUNBOOK_REQUIREMENTS_SCHEMA_VERSION}`,
            );
        }
        return fail("RunbookStudio.InvalidArtifact", "requirements schemaVersion invalid");
    }
    if (!Array.isArray(requirements.targets) || !Array.isArray(requirements.activities)) {
        return fail("RunbookStudio.InvalidArtifact", "requirements targets/activities missing");
    }
    const targetKinds = new Set<string>();
    for (const target of requirements.targets as unknown[]) {
        if (
            !isRecord(target) ||
            typeof target.kind !== "string" ||
            !TARGET_KINDS.has(target.kind) ||
            typeof target.environment !== "string" ||
            !TARGET_ENVIRONMENTS.has(target.environment)
        ) {
            return fail("RunbookStudio.InvalidArtifact", "requirements contains an invalid target");
        }
        if (targetKinds.has(target.kind)) {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `requirements contains duplicate target '${target.kind}'`,
            );
        }
        targetKinds.add(target.kind);
    }
    const activityKinds = new Set<string>();
    for (const activity of requirements.activities as unknown[]) {
        if (!isRecord(activity) || !isNonEmptyString(activity.kind)) {
            return fail("RunbookStudio.InvalidArtifact", "requirements activity missing kind");
        }
        if (activityKinds.has(activity.kind)) {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `requirements contains duplicate activity '${activity.kind}'`,
            );
        }
        activityKinds.add(activity.kind);
        if (!Number.isInteger(activity.version) || (activity.version as number) < 1) {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `requirement '${activity.kind}' has invalid version`,
            );
        }
        if (
            typeof activity.host !== "string" ||
            !REQUIREMENT_HOSTS.has(activity.host) ||
            (activity.minimumHostVersion !== undefined &&
                !isNonEmptyString(activity.minimumHostVersion)) ||
            (activity.providerRequirement !== undefined &&
                (typeof activity.providerRequirement !== "string" ||
                    !PROVIDER_REQUIREMENTS.has(activity.providerRequirement))) ||
            typeof activity.effect !== "string" ||
            !REQUIREMENT_EFFECTS.has(activity.effect) ||
            typeof activity.approvalRequired !== "boolean" ||
            typeof activity.connectionRequirement !== "string" ||
            !CONNECTION_REQUIREMENTS.has(activity.connectionRequirement) ||
            typeof activity.secretRequirement !== "string" ||
            !SECRET_REQUIREMENTS.has(activity.secretRequirement) ||
            typeof activity.rollbackContract !== "string" ||
            !ROLLBACK_CONTRACTS.has(activity.rollbackContract) ||
            !isNonEmptyString(activity.outputContract)
        ) {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `requirement '${activity.kind}' has invalid metadata`,
            );
        }
    }
    return undefined;
}

function validateParameter(
    parameter: unknown,
    seenIds: Set<string>,
): ArtifactParseFailure | undefined {
    if (!isRecord(parameter)) {
        return fail("RunbookStudio.InvalidArtifact", "parameter is not an object");
    }
    if (!isNonEmptyString(parameter.id)) {
        return fail("RunbookStudio.InvalidArtifact", "parameter missing id");
    }
    if (seenIds.has(parameter.id)) {
        return fail("RunbookStudio.InvalidArtifact", `duplicate parameter id '${parameter.id}'`);
    }
    seenIds.add(parameter.id);
    if (!isNonEmptyString(parameter.label)) {
        return fail("RunbookStudio.InvalidArtifact", `parameter '${parameter.id}' missing label`);
    }
    if (typeof parameter.type !== "string" || !PARAMETER_TYPES.has(parameter.type)) {
        return fail(
            "RunbookStudio.InvalidArtifact",
            `parameter '${parameter.id}' has unknown type`,
        );
    }
    if (parameter.type === "secret" && parameter.default !== undefined) {
        // Secrets are rebind-only: a default would persist secret material.
        return fail(
            "RunbookStudio.InvalidArtifact",
            `secret parameter '${parameter.id}' must not declare a default`,
        );
    }
    if (parameter.type === "enum") {
        if (
            !Array.isArray(parameter.enumValues) ||
            parameter.enumValues.length === 0 ||
            !parameter.enumValues.every((v: unknown) => typeof v === "string")
        ) {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `enum parameter '${parameter.id}' missing enumValues`,
            );
        }
    }
    return undefined;
}

function validateLock(lock: unknown): ArtifactParseFailure | undefined {
    if (!isRecord(lock)) {
        return fail("RunbookStudio.InvalidArtifact", "lock is not an object");
    }
    if (lock.schemaVersion !== RUNBOOK_LOCK_SCHEMA_VERSION) {
        if (typeof lock.schemaVersion === "number" && lock.schemaVersion > 1) {
            return fail(
                "RunbookStudio.IncompatibleVersion",
                `lock schemaVersion ${lock.schemaVersion} > supported 1`,
            );
        }
        return fail("RunbookStudio.InvalidArtifact", "lock schemaVersion invalid");
    }
    if (!isNonEmptyString(lock.planRevision) || !isNonEmptyString(lock.planHash)) {
        return fail("RunbookStudio.InvalidArtifact", "lock missing planRevision/planHash");
    }
    if (!Array.isArray(lock.nodes) || lock.nodes.length === 0) {
        return fail("RunbookStudio.InvalidArtifact", "lock has no nodes");
    }
    if (lock.nodes.length > MAX_NODES) {
        return fail("RunbookStudio.InvalidArtifact", "lock exceeds node limit");
    }
    if (!Array.isArray(lock.edges)) {
        return fail("RunbookStudio.InvalidArtifact", "lock.edges missing");
    }
    if (lock.edges.length > MAX_EDGES) {
        return fail("RunbookStudio.InvalidArtifact", "lock exceeds edge limit");
    }
    if (lock.libraryAssetRef !== undefined) {
        if (
            !isRecord(lock.libraryAssetRef) ||
            !isNonEmptyString(lock.libraryAssetRef.assetId) ||
            (lock.libraryAssetRef.versionLabel !== undefined &&
                !isNonEmptyString(lock.libraryAssetRef.versionLabel))
        ) {
            return fail("RunbookStudio.InvalidArtifact", "lock libraryAssetRef invalid");
        }
    }
    const nodeIds = new Set<string>();
    let hasRuntimeSemantics = false;
    for (const node of lock.nodes as unknown[]) {
        if (!isRecord(node) || !isNonEmptyString(node.id)) {
            return fail("RunbookStudio.InvalidArtifact", "lock node missing id");
        }
        if (nodeIds.has(node.id)) {
            return fail("RunbookStudio.InvalidArtifact", `duplicate node id '${node.id}'`);
        }
        nodeIds.add(node.id);
        if (!isNonEmptyString(node.label)) {
            return fail("RunbookStudio.InvalidArtifact", `node '${node.id}' missing label`);
        }
        if (typeof node.kind !== "string" || !NODE_KINDS.has(node.kind)) {
            return fail("RunbookStudio.InvalidArtifact", `node '${node.id}' has unknown kind`);
        }
        if (node.kind === "activity" && !isNonEmptyString(node.activityKind)) {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `activity node '${node.id}' missing activityKind`,
            );
        }
        if (node.previewOnly !== undefined && typeof node.previewOnly !== "boolean") {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `node '${node.id}' previewOnly metadata invalid`,
            );
        }
        if (node.runtime !== undefined) {
            hasRuntimeSemantics = true;
            const runtimeError = runtimeSemanticsShapeError(node.runtime, node.id);
            if (runtimeError !== undefined) {
                return fail("RunbookStudio.InvalidArtifact", runtimeError);
            }
        }
        if (node.target !== undefined) {
            if (!isRecord(node.target) || !TARGET_KINDS.has(String(node.target.kind))) {
                return fail("RunbookStudio.InvalidArtifact", `node '${node.id}' target invalid`);
            }
            const binding = node.target.binding;
            if (!isRecord(binding) || !isNonEmptyString(binding.source)) {
                return fail(
                    "RunbookStudio.InvalidArtifact",
                    `node '${node.id}' target binding invalid`,
                );
            }
            if (binding.source === "parameter") {
                if (!isNonEmptyString(binding.parameterId)) {
                    return fail(
                        "RunbookStudio.InvalidArtifact",
                        `node '${node.id}' target parameter binding invalid`,
                    );
                }
            } else if (binding.source === "nodeOutput") {
                if (!isNonEmptyString(binding.nodeId) || !isNonEmptyString(binding.output)) {
                    return fail(
                        "RunbookStudio.InvalidArtifact",
                        `node '${node.id}' target output binding invalid`,
                    );
                }
            } else if (binding.source === "workspace") {
                if (
                    binding.workspaceFolder !== undefined &&
                    typeof binding.workspaceFolder !== "string"
                ) {
                    return fail(
                        "RunbookStudio.InvalidArtifact",
                        `node '${node.id}' workspace target binding invalid`,
                    );
                }
            } else {
                return fail(
                    "RunbookStudio.InvalidArtifact",
                    `node '${node.id}' target binding source invalid`,
                );
            }
        }
    }
    if (hasRuntimeSemantics && lock.libraryAssetRef === undefined) {
        return fail(
            "RunbookStudio.InvalidArtifact",
            "runtime semantics require a libraryAssetRef authority",
        );
    }
    for (const node of lock.nodes as Array<Record<string, unknown>>) {
        if (!isRecord(node.runtime)) {
            continue;
        }
        const references: string[] = [];
        if (isRecord(node.runtime.decision)) {
            for (const branch of node.runtime.decision.branches as Array<Record<string, unknown>>) {
                references.push(...(branch.targetNodeIds as string[]));
            }
            if (isNonEmptyString(node.runtime.decision.defaultTargetNodeId)) {
                references.push(node.runtime.decision.defaultTargetNodeId);
            }
        }
        if (isRecord(node.runtime.parallel)) {
            references.push(...(node.runtime.parallel.branchNodeIds as string[]));
            if (isNonEmptyString(node.runtime.parallel.fanInTargetNodeId)) {
                references.push(node.runtime.parallel.fanInTargetNodeId);
            }
        }
        if (isRecord(node.runtime.approval)) {
            references.push(node.runtime.approval.onApprove as string);
            if (isNonEmptyString(node.runtime.approval.onReject)) {
                references.push(node.runtime.approval.onReject);
            }
        }
        const unknownReference = references.find((reference) => !nodeIds.has(reference));
        if (unknownReference !== undefined) {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `node '${node.id}' runtime semantics reference unknown node '${unknownReference}'`,
            );
        }
    }
    if (!isNonEmptyString(lock.entryNodeId) || !nodeIds.has(lock.entryNodeId)) {
        return fail("RunbookStudio.InvalidArtifact", "lock entryNodeId not a known node");
    }
    for (const edge of lock.edges as unknown[]) {
        if (!isRecord(edge) || !isNonEmptyString(edge.from) || !isNonEmptyString(edge.to)) {
            return fail("RunbookStudio.InvalidArtifact", "edge missing from/to");
        }
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
            return fail(
                "RunbookStudio.InvalidArtifact",
                `edge ${edge.from}->${edge.to} references unknown node`,
            );
        }
        if (
            edge.when !== undefined &&
            (typeof edge.when !== "string" || !EDGE_WHEN.has(edge.when))
        ) {
            return fail("RunbookStudio.InvalidArtifact", "edge has unknown condition");
        }
        if (edge.label !== undefined && !isNonEmptyString(edge.label)) {
            return fail("RunbookStudio.InvalidArtifact", "edge has invalid label");
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Canonical serialization + content hash
// ---------------------------------------------------------------------------

function sortKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeysDeep);
    }
    if (isRecord(value)) {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort()) {
            const entry = value[key];
            if (entry !== undefined) {
                sorted[key] = sortKeysDeep(entry);
            }
        }
        return sorted;
    }
    return value;
}

/** Ordinal-sorted keys, 2-space indent, LF, trailing newline (ADR-4). */
export function canonicalizeRunbookArtifact(artifact: RunbookArtifactFile): string {
    return JSON.stringify(sortKeysDeep(artifact), undefined, 2) + "\n";
}

/** sha256 over canonical source+lock only — presentation edits never
 *  invalidate a compiled plan; plan/source edits always do. */
export function computeContentHash(artifact: RunbookArtifactFile): string {
    const hashed = sortKeysDeep({
        id: artifact.id,
        source: artifact.source,
        lock: artifact.lock ?? null,
    });
    return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(hashed)).digest("hex");
}

/** Hash the plan a lock would be computed against (source+nodes/edges). */
export function computePlanHash(
    source: RunbookArtifactFile["source"],
    lock: Pick<CompiledRunbookLock, "entryNodeId" | "nodes" | "edges">,
): string {
    const hashed = sortKeysDeep({
        source,
        entryNodeId: lock.entryNodeId,
        nodes: lock.nodes,
        edges: lock.edges,
    });
    return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(hashed)).digest("hex");
}

// ---------------------------------------------------------------------------
// Templates and fixtures
// ---------------------------------------------------------------------------

/** Fresh-document template for `Runbook Studio: New Runbook`. */
/** Derive a display name from the authored intent: the first sentence (or
 *  clause) capped at 60 chars on a word boundary, first letter uppercased,
 *  trailing punctuation stripped. Pure and deterministic — used when a plan
 *  compiles while the document still wears the New-Runbook placeholder. */
export function deriveRunbookName(intent: string): string {
    const firstSentence = intent.trim().split(/[.?!\n]/, 1)[0] ?? "";
    let name = firstSentence.trim().replace(/[\s,;:-]+$/, "");
    if (name.length > 60) {
        const cut = name.slice(0, 60);
        const lastSpace = cut.lastIndexOf(" ");
        name = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd();
    }
    if (name.length === 0) {
        const fallback = intent.trim().slice(0, 60);
        // Punctuation-only intents ("?!") make no name at all.
        return /\w/.test(fallback) ? fallback : "Runbook";
    }
    return name.charAt(0).toUpperCase() + name.slice(1);
}

export function createNewRunbookArtifact(name: string, id: string): RunbookArtifactFile {
    return {
        schemaVersion: 1,
        id,
        name,
        source: {
            schemaVersion: RUNBOOK_SOURCE_SCHEMA_VERSION,
            intent: "",
            parameters: [],
        },
    };
}

/**
 * Deterministic precompiled fixture used by tests and perf scenarios: a
 * three-node read-only plan (query -> threshold -> report) with one
 * connection parameter. No model is ever needed to execute it.
 */
export function createFixtureRunbookArtifact(): RunbookArtifactFile {
    const artifact: RunbookArtifactFile = {
        schemaVersion: 1,
        id: "fixture-readonly-check",
        name: "Read-only health check (fixture)",
        description: "Deterministic fixture: run one read-only query and assert a threshold.",
        family: "validate",
        source: {
            schemaVersion: RUNBOOK_SOURCE_SCHEMA_VERSION,
            intent: "Run a read-only health query against the selected connection and verify the result stays within the configured threshold.",
            parameters: [
                {
                    id: "target",
                    label: "Target connection",
                    type: "connection",
                    required: true,
                },
                {
                    id: "maxCount",
                    label: "Maximum row count",
                    type: "int",
                    default: 100,
                },
            ],
        },
        lock: {
            schemaVersion: RUNBOOK_LOCK_SCHEMA_VERSION,
            planRevision: "1",
            planHash: "",
            entryNodeId: "query",
            nodes: [
                {
                    id: "query",
                    label: "Run health query",
                    kind: "activity",
                    activityKind: "sql.query.read",
                    activityVersion: 1,
                    // Keep the fixture valid against the same host-authoritative
                    // read-only SQL admission rule used for generated plans.
                    // The deterministic fake does not execute this text.
                    inputs: { connection: "$params.target", sql: "SELECT 1 AS [value]" },
                    target: {
                        kind: "sqlDatabase",
                        binding: { source: "parameter", parameterId: "target" },
                    },
                    blastRadius: {
                        resource: "none",
                        operation: "read",
                        targetEnvironment: "local",
                        reversibility: "noEffect",
                    },
                },
                {
                    id: "threshold",
                    label: "Assert row count under limit",
                    kind: "activity",
                    activityKind: "assert.threshold",
                    activityVersion: 1,
                    inputs: {
                        value: "$nodes.query.rowCount",
                        max: "$params.maxCount",
                    },
                    blastRadius: {
                        resource: "none",
                        operation: "read",
                        targetEnvironment: "local",
                        reversibility: "noEffect",
                    },
                },
                {
                    id: "report",
                    label: "Summarize verdict",
                    kind: "report",
                },
            ],
            edges: [
                { from: "query", to: "threshold" },
                { from: "threshold", to: "report" },
            ],
        },
    };
    artifact.lock!.planHash = computePlanHash(artifact.source, artifact.lock!);
    return artifact;
}
