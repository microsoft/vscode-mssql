/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunbookPlanNode, RunbookRunSnapshot } from "../../../sharedInterfaces/runbookStudio";

export const RESULT_FILE_ARTIFACT_CONTRACTS = new Set([
    "dacpacArtifact/1",
    "schemaDiff/1",
    "schemaCompareDocument/1",
    "workloadArtifact/1",
    "xelArtifact/1",
    "gitChangeSet/1",
]);

const MAX_RESULT_ARTIFACTS = 32;
const RESULT_FILE_ARTIFACT_PRODUCERS: Record<string, ReadonlySet<string>> = {
    "dacpacArtifact/1": new Set(["dacpac.build", "dacpac.extract"]),
    "schemaDiff/1": new Set(["schema.compare.export"]),
    "schemaCompareDocument/1": new Set(["schema.compare.export"]),
    "workloadArtifact/1": new Set(["sql.workload.generate"]),
    "xelArtifact/1": new Set(["xevent.xel.collect"]),
    "gitChangeSet/1": new Set(["git.change-set.inspect"]),
};

export interface ResultArtifactCandidate {
    handleId: string;
    contract: string;
    nodeId: string;
    nodeLabel: string;
    expired: boolean;
    truncated: boolean;
}

export interface ResultArtifactProjection {
    artifacts: ResultArtifactCandidate[];
    omittedCount: number;
}

export function isResultFileArtifactContract(contract: string): boolean {
    return RESULT_FILE_ARTIFACT_CONTRACTS.has(contract);
}

/** Pure, payload-free projection of retained file handles for the Results
 * artifact shelf. File names and availability stay host-authoritative and
 * are resolved later through the selected-run artifact RPC. */
export function projectResultArtifacts(
    run: RunbookRunSnapshot,
    planNodes: RunbookPlanNode[],
): ResultArtifactProjection {
    const nodesById = new Map(planNodes.map((node) => [node.id, node]));
    const seen = new Set<string>();
    const artifacts: ResultArtifactCandidate[] = [];
    let uniqueCount = 0;

    for (const node of run.nodes) {
        for (const output of node.outputs ?? []) {
            if (!isResultFileArtifactContract(output.contract) || seen.has(output.handleId)) {
                continue;
            }
            const planNode = nodesById.get(node.nodeId);
            const knownProducers = RESULT_FILE_ARTIFACT_PRODUCERS[output.contract];
            if (
                planNode &&
                (!planNode.activityKind || !knownProducers?.has(planNode.activityKind))
            ) {
                continue;
            }
            seen.add(output.handleId);
            uniqueCount++;
            if (artifacts.length >= MAX_RESULT_ARTIFACTS) {
                continue;
            }
            artifacts.push({
                handleId: output.handleId,
                contract: output.contract,
                nodeId: node.nodeId,
                nodeLabel: planNode?.label ?? node.nodeId,
                expired: output.expired === true,
                truncated: output.truncated === true,
            });
        }
    }

    return {
        artifacts,
        omittedCount: Math.max(0, uniqueCount - artifacts.length),
    };
}
