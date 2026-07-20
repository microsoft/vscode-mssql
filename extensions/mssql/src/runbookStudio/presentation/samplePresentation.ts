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
): RunbookRunSnapshot | undefined {
    if (!artifact.lock) {
        return undefined;
    }
    return {
        runId: "sample-preview",
        runbookId: artifact.id,
        planRevision: artifact.lock.planRevision,
        planHash: artifact.lock.planHash,
        state: "succeeded",
        seq: 0,
        verdict: "pass",
        nodes: artifact.lock.nodes.map((node) => {
            const contract = expectedContractFor(node.kind, node.activityKind);
            return {
                nodeId: node.id,
                state: "succeeded" as const,
                attempt: 1,
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
