/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Deterministic, bounded sample data for the pre-run layout preview. Sample
 * handles use the normal page-pull RPC but can never reach the result store or
 * SQL runtime. They are display fixtures, not execution evidence. */

import { RunbookArtifactFile, RunbookRunSnapshot } from "../../sharedInterfaces/runbookStudio";
import { expectedContractFor } from "../../sharedInterfaces/runbookPresentation";

const SAMPLE_HANDLE_PREFIX = "rbs-sample:";

export function createSampleRunSnapshot(
    artifact: RunbookArtifactFile,
    scenario: "clean" | "blockingErrors" | "approvalRejected" = "clean",
): RunbookRunSnapshot | undefined {
    if (!artifact.lock) {
        return undefined;
    }
    const failureNodeId = failureNode(artifact, scenario);
    if (scenario !== "clean" && !failureNodeId) {
        return undefined;
    }
    const branchNotTaken = branchNotTakenNodes(artifact, scenario);
    return {
        runId: `sample-preview-${scenario}`,
        runbookId: artifact.id,
        planRevision: artifact.lock.planRevision,
        planHash: artifact.lock.planHash,
        state: scenario === "clean" ? "succeeded" : "failed",
        seq: 0,
        verdict: scenario === "clean" ? "pass" : "fail",
        nodes: artifact.lock.nodes.map((node) => {
            const contract = expectedContractFor(node.kind, node.activityKind);
            if (branchNotTaken.has(node.id)) {
                return {
                    nodeId: node.id,
                    state: "skipped" as const,
                    attempt: 0,
                    outcome: "skipped" as const,
                    branchNotTaken: true,
                    message: "Not executed — branch not taken.",
                };
            }
            const failed = node.id === failureNodeId;
            return {
                nodeId: node.id,
                state: failed ? ("failed" as const) : ("succeeded" as const),
                attempt: 1,
                ...(failed
                    ? {
                          outcome:
                              scenario === "approvalRejected"
                                  ? ("policyDenied" as const)
                                  : ("failure" as const),
                      }
                    : {}),
                ...(contract
                    ? {
                          outputs: [
                              {
                                  handleId: sampleHandleId(contract, node.id),
                                  slot: "primary",
                                  contract,
                                  rows: sampleRows(contract).rows.length,
                              },
                          ],
                      }
                    : {}),
            };
        }),
    };
}

function failureNode(
    artifact: RunbookArtifactFile,
    scenario: "clean" | "blockingErrors" | "approvalRejected",
): string | undefined {
    const lock = artifact.lock;
    if (!lock || scenario === "clean") {
        return undefined;
    }
    if (scenario === "approvalRejected") {
        return lock.nodes.find((node) => node.kind === "gate")?.id;
    }
    const outputNodes = lock.nodes.filter(
        (node) => expectedContractFor(node.kind, node.activityKind) !== undefined,
    );
    const preferred = outputNodes.find(
        (node) =>
            /^(schema\.compare|sqltest\.run|tsqlt\.run|assert\.threshold)$/.test(
                node.activityKind ?? "",
            ) && descendantsOf(lock.edges, node.id).size > 0,
    );
    return (
        preferred ??
        outputNodes.find((node) => descendantsOf(lock.edges, node.id).size > 0) ??
        outputNodes[outputNodes.length - 1]
    )?.id;
}

function branchNotTakenNodes(
    artifact: RunbookArtifactFile,
    scenario: "clean" | "blockingErrors" | "approvalRejected",
): Set<string> {
    const failed = failureNode(artifact, scenario);
    return failed && artifact.lock ? descendantsOf(artifact.lock.edges, failed) : new Set();
}

function descendantsOf(edges: Array<{ from: string; to: string }>, nodeId: string): Set<string> {
    const outgoing = new Map<string, string[]>();
    for (const edge of edges) {
        const targets = outgoing.get(edge.from) ?? [];
        targets.push(edge.to);
        outgoing.set(edge.from, targets);
    }
    const descendants = new Set<string>();
    const pending = [...(outgoing.get(nodeId) ?? [])];
    while (pending.length > 0) {
        const current = pending.shift()!;
        if (descendants.has(current)) {
            continue;
        }
        descendants.add(current);
        pending.push(...(outgoing.get(current) ?? []));
    }
    return descendants;
}

export function isSampleHandle(handleId: string): boolean {
    return handleId.startsWith(SAMPLE_HANDLE_PREFIX);
}

export function fetchSampleOutputPage(request: {
    handleId: string;
    startRow: number;
    rowCount: number;
}):
    | {
          columns: string[];
          rows: Array<Array<string | number | boolean | null>>;
          totalRows: number;
      }
    | undefined {
    const contract = contractFromHandle(request.handleId);
    if (!contract) {
        return undefined;
    }
    const page = sampleRows(contract);
    const start = Math.max(0, Math.floor(request.startRow));
    const count = Math.max(0, Math.min(100, Math.floor(request.rowCount)));
    return {
        columns: page.columns,
        rows: page.rows.slice(start, start + count),
        totalRows: page.rows.length,
    };
}

function sampleHandleId(contract: string, nodeId: string): string {
    return `${SAMPLE_HANDLE_PREFIX}${encodeURIComponent(contract)}:${encodeURIComponent(nodeId)}`;
}

function contractFromHandle(handleId: string): string | undefined {
    if (!isSampleHandle(handleId)) {
        return undefined;
    }
    const encoded = handleId.slice(SAMPLE_HANDLE_PREFIX.length).split(":", 1)[0];
    try {
        return decodeURIComponent(encoded);
    } catch {
        return undefined;
    }
}

function sampleRows(contract: string): {
    columns: string[];
    rows: Array<Array<string | number | boolean | null>>;
} {
    switch (contract) {
        case "rowset/1":
        case "testSuiteDiscovery/1":
        case "testResults/1":
            return {
                columns: ["Item", "Value", "ObservedAt"],
                rows: [
                    ["Orders", 7110, "2026-07-17T09:00:00Z"],
                    ["Customers", 5000, "2026-07-18T09:00:00Z"],
                    ["Products", 1200, "2026-07-19T09:00:00Z"],
                ],
            };
        case "markdown/1":
            return {
                columns: ["Summary"],
                rows: [["## Sample summary\nAll configured validation checks passed."]],
            };
        case "log/1":
        case "deploymentPreview/1":
        case "schemaDiff/1":
        case "schemaCompareDocument/1":
        case "databaseSchemaGraph/1":
        case "evidenceBundle/1":
            return {
                columns: ["Message"],
                rows: [
                    ["Sample · validation started"],
                    ["Sample · no blocking changes detected"],
                    ["Sample · evidence bundle ready"],
                ],
            };
        default:
            return {
                columns: ["Metric", "Value"],
                rows: [
                    ["Status", "Ready"],
                    ["Checks", 12],
                    ["Warnings", 0],
                ],
            };
    }
}
