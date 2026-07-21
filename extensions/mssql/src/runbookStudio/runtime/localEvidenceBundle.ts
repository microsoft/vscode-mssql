/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Secret-safe evidence manifest construction for the local developer lane.
 * The bundle contains durable result handles and allowlisted scalar evidence,
 * never row payloads, SQL text, connection identifiers, or local file paths.
 */

import * as crypto from "crypto";
import { DataHandleRef, RunbookNodeStateKind } from "../../sharedInterfaces/runbookStudio";
import type {
    LocalToolchainComponentId,
    LocalToolchainProvenance,
} from "./localToolchainProvenance";

export type LocalEvidenceVerdict = "pass" | "fail" | "indeterminate";

export interface LocalEvidenceNodeInput {
    nodeId: string;
    activityKind?: string;
    state: RunbookNodeStateKind;
    attempt: number;
    outcome?: "success" | "failure" | "cancelled" | "skipped" | "policyDenied";
    outputs?: DataHandleRef[];
    scalars?: Record<string, number | string | boolean>;
}

export interface LocalEvidenceBundleInput {
    runId: string;
    runbookId: string;
    planRevision: string;
    planHash: string;
    runtimeKind: string;
    toolchain: LocalToolchainProvenance;
    nodes: LocalEvidenceNodeInput[];
    generatedAtUtc?: string;
}

export interface LocalEvidenceBundleResult {
    bundleSha256: string;
    manifestJson: string;
    nodeCount: number;
    passedNodeCount: number;
    failedNodeCount: number;
    evidenceHandleCount: number;
    verdict: LocalEvidenceVerdict;
    generatedAtUtc: string;
}

interface EvidenceManifestNode {
    nodeId: string;
    activityKind?: string;
    state: RunbookNodeStateKind;
    attempt: number;
    outcome?: LocalEvidenceNodeInput["outcome"];
    outputs: DataHandleRef[];
    evidenceScalars?: Record<string, number | string | boolean>;
}

/** Build a stable, content-addressed manifest. `generatedAtUtc` is metadata
 * and intentionally excluded from the digest, so retrying aggregation over
 * the same run evidence yields the same bundle identity. */
export function buildLocalEvidenceBundle(
    input: LocalEvidenceBundleInput,
): LocalEvidenceBundleResult {
    const nodes: EvidenceManifestNode[] = input.nodes.map((node) => {
        const evidenceScalars = selectEvidenceScalars(node.scalars);
        return {
            nodeId: node.nodeId,
            ...(node.activityKind ? { activityKind: node.activityKind } : {}),
            state: node.state,
            attempt: node.attempt,
            ...(node.outcome ? { outcome: node.outcome } : {}),
            outputs: (node.outputs ?? []).map((output) => ({ ...output })),
            ...(Object.keys(evidenceScalars).length > 0 ? { evidenceScalars } : {}),
        };
    });
    const failedNodeCount = nodes.filter(
        (node) =>
            node.state === "failed" ||
            node.state === "cancelled" ||
            node.outcome === "failure" ||
            node.outcome === "policyDenied" ||
            node.outcome === "cancelled",
    ).length;
    const passedNodeCount = nodes.filter(
        (node) => node.state === "succeeded" && node.outcome !== "failure",
    ).length;
    const evidenceHandleCount = nodes.reduce((count, node) => count + node.outputs.length, 0);
    const requiredToolchainComponents = selectRequiredToolchainComponents(nodes, input.runtimeKind);
    const resolvedToolchainComponents = new Set(
        input.toolchain.components
            .filter((component) => component.status === "resolved")
            .map((component) => component.id),
    );
    const toolchainComplete = requiredToolchainComponents.every((component) =>
        resolvedToolchainComponents.has(component),
    );
    const incompleteEvidence =
        !toolchainComplete ||
        nodes.some((node) =>
            node.outputs.some((output) => output.expired === true || output.truncated === true),
        );
    const verdict: LocalEvidenceVerdict =
        failedNodeCount > 0
            ? "fail"
            : nodes.length === 0 || incompleteEvidence
              ? "indeterminate"
              : "pass";
    const content = {
        schemaVersion: 2,
        contract: "evidenceBundle/1",
        run: {
            runId: input.runId,
            runbookId: input.runbookId,
            planRevision: input.planRevision,
            planHash: input.planHash,
            runtimeKind: input.runtimeKind,
        },
        summary: {
            verdict,
            nodeCount: nodes.length,
            passedNodeCount,
            failedNodeCount,
            evidenceHandleCount,
            incompleteEvidence,
            toolchainComplete,
        },
        toolchain: {
            complete: toolchainComplete,
            allComponentsResolved: input.toolchain.complete,
            requiredComponents: requiredToolchainComponents,
            components: input.toolchain.components.map((component) => ({ ...component })),
        },
        nodes,
    };
    const bundleSha256 = crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
    const generatedAtUtc = input.generatedAtUtc ?? new Date().toISOString();
    return {
        bundleSha256,
        manifestJson: JSON.stringify({ ...content, bundleSha256, generatedAtUtc }, undefined, 2),
        nodeCount: nodes.length,
        passedNodeCount,
        failedNodeCount,
        evidenceHandleCount,
        verdict,
        generatedAtUtc,
    };
}

function selectRequiredToolchainComponents(
    nodes: EvidenceManifestNode[],
    runtimeKind: string,
): LocalToolchainComponentId[] {
    const required = new Set<LocalToolchainComponentId>(["vscode", "mssqlExtension"]);
    // The deterministic fake executes no SQL, DacFx, project build, process,
    // network, or filesystem effects. Its synthetic activity names must not
    // imply that those providers participated in preview evidence.
    if (runtimeKind === "fake") {
        return ["vscode", "mssqlExtension"];
    }
    for (const node of nodes) {
        switch (node.activityKind) {
            case "dacpac.build":
                required.add("sqlDatabaseProjectsExtension");
                required.add("sqlToolsService");
                break;
            case "dacpac.deploy.preview":
            case "dacpac.deploy":
            case "dacpac.deploy.dev":
            case "dacpac.deploy.container":
            case "dacpac.extract":
            case "schema.compare":
            case "schema.compare.export":
                required.add("sqlToolsService");
                required.add("dacFx");
                if (node.activityKind === "dacpac.deploy.container") {
                    required.add("dockerEngine");
                }
                break;
            case "devdatabase.provision":
            case "sql.schema.apply":
            case "sql.container.provision":
            case "xevent.session.start":
            case "sql.workload.run":
            case "xevent.session.stop":
            case "xevent.xel.collect":
            case "sandbox.provision":
            case "sandbox.dispose":
            case "sql.container.dispose":
            case "sqltest.run":
            case "tsqlt.run":
            case "sql.query.read":
                required.add("sqlToolsService");
                if (
                    node.activityKind === "sql.container.provision" ||
                    node.activityKind === "xevent.session.start" ||
                    node.activityKind === "sql.workload.run" ||
                    node.activityKind === "xevent.session.stop" ||
                    node.activityKind === "xevent.xel.collect" ||
                    node.activityKind === "sql.container.dispose"
                ) {
                    required.add("dockerEngine");
                }
                break;
        }
    }
    const componentOrder: LocalToolchainComponentId[] = [
        "vscode",
        "mssqlExtension",
        "sqlDatabaseProjectsExtension",
        "sqlToolsService",
        "dacFx",
        "dockerEngine",
    ];
    return componentOrder.filter((component) => required.has(component));
}

/** Numbers and booleans are safe aggregate evidence. String values are
 * retained only when their key identifies a digest; paths, SQL, messages,
 * connection handles, lease ids, and operation ids stay out of the bundle. */
function selectEvidenceScalars(
    scalars: Record<string, number | string | boolean> | undefined,
): Record<string, number | string | boolean> {
    if (!scalars) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(scalars)
            .filter(
                ([key, value]) =>
                    typeof value === "number" ||
                    typeof value === "boolean" ||
                    (typeof value === "string" && /(sha256|digest)$/i.test(key)),
            )
            .sort(([left], [right]) => left.localeCompare(right)),
    );
}
