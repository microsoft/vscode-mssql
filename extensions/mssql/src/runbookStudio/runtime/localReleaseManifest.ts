/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Canonical release-candidate evidence for the owned local developer lane.
 * This manifest is proof of one tested candidate; it never grants authority
 * to address or mutate a protected target.
 */

import * as crypto from "crypto";
import { canonicalRunbookJson } from "../runbookDigest";
import type {
    LocalToolchainComponentId,
    LocalToolchainProvenance,
} from "./localToolchainProvenance";

export interface LocalReleaseManifestInput {
    runId: string;
    runbookId: string;
    planRevision: string;
    planHash: string;
    baseCommit: string;
    headCommit: string;
    changeSetSha256: string;
    baseModelSha256: string;
    headModelSha256: string;
    modelDiffSha256: string;
    migrationManifestSha256: string;
    baseDacpacSha256: string;
    baseSchemaReportSha256: string;
    forwardConvergenceSha256: string;
    forwardConverged: boolean;
    workloadSha256: string;
    workloadFingerprint: string;
    environmentFingerprint: string;
    beforeSchemaSha256: string;
    afterSchemaSha256: string;
    performanceDeltaSha256: string;
    schemaComparability: string;
    failedBatchCount: number;
    xelSha256: string;
    captureComplete: boolean;
    candidateDacpacSha256: string;
    toolchain: LocalToolchainProvenance;
    generatedAtUtc?: string;
}

export interface LocalReleaseManifestResult {
    manifestSha256: string;
    manifestJson: string;
    evidenceCount: number;
    evidenceComplete: boolean;
    protectedDeploymentAuthorized: false;
    generatedAtUtc: string;
}

const REQUIRED_TOOLCHAIN_COMMON = [
    "mssqlExtension",
    "sqlToolsService",
    "dacFx",
    "dockerEngine",
] as const;

export function buildLocalReleaseManifest(
    input: LocalReleaseManifestInput,
): LocalReleaseManifestResult {
    const digestFields = {
        changeSetSha256: input.changeSetSha256,
        baseModelSha256: input.baseModelSha256,
        headModelSha256: input.headModelSha256,
        modelDiffSha256: input.modelDiffSha256,
        migrationManifestSha256: input.migrationManifestSha256,
        baseDacpacSha256: input.baseDacpacSha256,
        baseSchemaReportSha256: input.baseSchemaReportSha256,
        forwardConvergenceSha256: input.forwardConvergenceSha256,
        workloadSha256: input.workloadSha256,
        workloadFingerprint: input.workloadFingerprint,
        environmentFingerprint: input.environmentFingerprint,
        performanceDeltaSha256: input.performanceDeltaSha256,
        xelSha256: input.xelSha256,
        candidateDacpacSha256: input.candidateDacpacSha256,
    };
    const normalizedDigestFields: Record<string, string> = {};
    for (const [name, value] of Object.entries(digestFields)) {
        const normalized = normalizeSha256(value);
        if (!normalized) {
            throw new Error(`invalid release manifest digest '${name}'`);
        }
        normalizedDigestFields[name] = normalized;
    }
    const beforeSchemaIdentity = normalizeSchemaIdentity(input.beforeSchemaSha256);
    const afterSchemaIdentity = normalizeSchemaIdentity(input.afterSchemaSha256);
    if (!beforeSchemaIdentity || !afterSchemaIdentity) {
        throw new Error("invalid release manifest schema fingerprint");
    }
    if (
        !/^[a-f0-9]{40,64}$/i.test(input.baseCommit) ||
        !/^[a-f0-9]{40,64}$/i.test(input.headCommit) ||
        input.baseCommit.toLowerCase() === input.headCommit.toLowerCase()
    ) {
        throw new Error("invalid release manifest commit identity");
    }
    if (
        !input.forwardConverged ||
        input.failedBatchCount !== 0 ||
        !input.captureComplete ||
        input.schemaComparability !== "same" ||
        beforeSchemaIdentity.value !== afterSchemaIdentity.value ||
        beforeSchemaIdentity.kind !== afterSchemaIdentity.kind
    ) {
        throw new Error("release candidate validation evidence is incomplete or failed");
    }
    const resolvedToolchain = new Set(
        input.toolchain.components
            .filter((component) => component.status === "resolved")
            .map((component) => component.id),
    );
    const executionHost: LocalToolchainComponentId = resolvedToolchain.has("headlessRunner")
        ? "headlessRunner"
        : "vscode";
    const requiredToolchain: LocalToolchainComponentId[] = [
        executionHost,
        ...REQUIRED_TOOLCHAIN_COMMON,
    ];
    const evidenceComplete = requiredToolchain.every((component) =>
        resolvedToolchain.has(component),
    );
    const evidence: Array<
        | { kind: string; sha256: string }
        | { kind: string; schemaFingerprint: string; fingerprintKind: string }
    > = Object.entries(normalizedDigestFields).map(([kind, sha256]) => ({ kind, sha256 }));
    for (const [kind, identity] of [
        ["beforeSchemaSha256", beforeSchemaIdentity],
        ["afterSchemaSha256", afterSchemaIdentity],
    ] as const) {
        evidence.push(
            identity.kind === "sha256"
                ? { kind, sha256: identity.value }
                : {
                      kind,
                      schemaFingerprint: identity.value,
                      fingerprintKind: "schemaVisualizer/1",
                  },
        );
    }
    evidence.sort((left, right) => left.kind.localeCompare(right.kind));
    const content = {
        schemaVersion: 1,
        contract: "releaseManifest/1",
        run: {
            runId: input.runId,
            runbookId: input.runbookId,
            planRevision: input.planRevision,
            planHash: input.planHash,
        },
        source: {
            baseCommit: input.baseCommit.toLowerCase(),
            headCommit: input.headCommit.toLowerCase(),
        },
        validation: {
            forwardConverged: input.forwardConverged,
            schemaComparability: input.schemaComparability,
            failedBatchCount: input.failedBatchCount,
            captureComplete: input.captureComplete,
            evidenceComplete,
        },
        authority: {
            scope: "ownedContainerCandidate",
            protectedDeploymentAuthorized: false,
        },
        toolchain: {
            requiredComponents: requiredToolchain,
            components: input.toolchain.components
                .map((component) => ({ ...component }))
                .sort((left, right) => left.id.localeCompare(right.id)),
        },
        evidence,
    };
    const manifestSha256 = crypto
        .createHash("sha256")
        .update(canonicalRunbookJson(content))
        .digest("hex");
    const generatedAtUtc = input.generatedAtUtc ?? new Date().toISOString();
    return {
        manifestSha256,
        manifestJson: JSON.stringify({ ...content, manifestSha256, generatedAtUtc }, undefined, 2),
        evidenceCount: evidence.length,
        evidenceComplete,
        protectedDeploymentAuthorized: false,
        generatedAtUtc,
    };
}

function normalizeSha256(value: string): string | undefined {
    const normalized = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
    return /^[a-f0-9]{64}$/i.test(normalized) ? normalized.toLowerCase() : undefined;
}

function normalizeSchemaIdentity(
    value: string,
): { kind: "sha256" | "schemaVisualizer"; value: string } | undefined {
    const sha256 = normalizeSha256(value);
    if (sha256) {
        return { kind: "sha256", value: sha256 };
    }
    return /^svf_[A-Za-z0-9_-]{22}$/.test(value) ? { kind: "schemaVisualizer", value } : undefined;
}
