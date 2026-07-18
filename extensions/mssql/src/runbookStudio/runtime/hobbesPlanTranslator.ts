/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Artifact -> Hobbes plan translation (the publish bridge, verified live
 * against runtime 0.1.0 via the studio API: create -> PUT plan -> approve ->
 * launch -> confirm -> AG-UI kickoff -> assert.threshold executed on MAF).
 *
 * Deliberately supports the DETERMINISTIC SUBSET today and refuses the rest
 * with exact reasons (never silent downgrades):
 *   - sql.query.read  -> primitive:sql.execute-query { query }
 *   - assert.threshold (literal inputs) -> primitive:assert.threshold
 *   - report          -> Report node with deterministic reportSections
 *   - gates, conditional edges, and cross-node bind expressions are not
 *     translated yet (issues returned; publish is refused).
 * Pure module — no vscode imports; unit-tested.
 */

import { RunbookArtifactFile } from "../../sharedInterfaces/runbookStudio";

export interface HobbesPlanNode {
    id: string;
    type: string;
    role?: string;
    strategy?: string;
    primitiveArgs?: Record<string, unknown>;
    outputKey?: string;
    metadata?: {
        reportSections?: Array<{
            id: string;
            title: string;
            bodyTemplate: string;
            supportingRegionIds: string[];
        }>;
    };
}

export interface HobbesPlan {
    id: string;
    version: string;
    goal: string;
    status: "draft";
    entryNodeId: string;
    nodes: HobbesPlanNode[];
    edges: Array<{ id: string; from: string; to: string }>;
    inputSchema: Array<{
        name: string;
        kind: string;
        cardinality: string;
        required: boolean;
        description: string;
    }>;
}

export interface TranslationResult {
    plan?: HobbesPlan;
    issues: string[];
}

/** The runtime's V1 convention: one required connection input named
 *  `database` (verified: launch refuses plans without a bound connection). */
const DATABASE_INPUT = {
    name: "database",
    kind: "connection",
    cardinality: "one",
    required: true,
    description: "Primary database connection.",
};

function isLiteral(value: unknown): value is string | number | boolean {
    if (typeof value === "number" || typeof value === "boolean") {
        return true;
    }
    return typeof value === "string" && !value.startsWith("$");
}

export function translateArtifactToHobbesPlan(artifact: RunbookArtifactFile): TranslationResult {
    const issues: string[] = [];
    const lock = artifact.lock;
    if (!lock) {
        return { issues: ["artifact has no compiled lock"] };
    }
    for (const edge of lock.edges) {
        if (edge.when !== undefined && edge.when !== "success") {
            issues.push(
                `conditional edge ${edge.from}->${edge.to} [${edge.when}] is not publishable yet`,
            );
        }
    }

    const nodes: HobbesPlanNode[] = [];
    for (const node of lock.nodes) {
        if (node.kind === "gate") {
            issues.push(`gate node '${node.id}' is not publishable yet`);
            continue;
        }
        if (node.kind === "report") {
            nodes.push({
                id: node.id,
                type: "Report",
                role: "report",
                metadata: {
                    // Deterministic template — the runtime REQUIRES
                    // metadata.reportSections for model-free report nodes.
                    reportSections: [
                        {
                            id: `${node.id}-summary`,
                            title: node.label || "Summary",
                            bodyTemplate: `Runbook '${artifact.name}' completed its checks.`,
                            supportingRegionIds: [],
                        },
                    ],
                },
            });
            continue;
        }
        switch (node.activityKind) {
            case "sql.query.read": {
                const sql = node.inputs?.sql;
                if (typeof sql !== "string" || sql.trim().length === 0) {
                    issues.push(`node '${node.id}' has no literal SQL to publish`);
                    continue;
                }
                nodes.push({
                    id: node.id,
                    type: "Observation",
                    strategy: "primitive:sql.execute-query",
                    primitiveArgs: {
                        query: sql,
                        // Required by the primitive (≤80 chars; runtime
                        // rejects the call without it — verified live).
                        queryDescription: (node.label || node.id).slice(0, 80),
                    },
                    outputKey: node.id,
                });
                break;
            }
            case "assert.threshold": {
                const value = node.inputs?.value;
                const max = node.inputs?.max;
                if (!isLiteral(value) || !isLiteral(max)) {
                    issues.push(
                        `node '${node.id}' uses bind expressions; only literal thresholds publish today`,
                    );
                    continue;
                }
                nodes.push({
                    id: node.id,
                    type: "Observation",
                    strategy: "primitive:assert.threshold",
                    primitiveArgs: {
                        metric: value,
                        threshold: max,
                        operator: "<=",
                        trueLabel: "pass",
                        falseLabel: "fail",
                    },
                    outputKey: node.id,
                });
                break;
            }
            default:
                issues.push(
                    `node '${node.id}' activity '${node.activityKind}' has no Hobbes translation`,
                );
        }
    }

    if (issues.length > 0) {
        return { issues };
    }

    const publishedIds = new Set(nodes.map((n) => n.id));
    const edges = lock.edges
        .filter((e) => publishedIds.has(e.from) && publishedIds.has(e.to))
        .map((e, index) => ({ id: `e${index + 1}`, from: e.from, to: e.to }));

    return {
        plan: {
            id: artifact.id,
            version: "1.0.0",
            goal: artifact.source.intent || artifact.description || artifact.name,
            status: "draft",
            entryNodeId: lock.entryNodeId,
            nodes,
            edges,
            inputSchema: [DATABASE_INPUT],
        },
        issues: [],
    };
}

// ---------------------------------------------------------------------------
// Connection registry merge (the runtime's JsonFile provider file — property
// names are case-SENSITIVE PascalCase, verified against the seeded file).
// ---------------------------------------------------------------------------

export interface HobbesConnectionsFile {
    DatabaseConnections: Array<{ Name: string; Description?: string; ConnectionString: string }>;
    ServerConnections: Array<{ Name: string; Description?: string; ConnectionString: string }>;
}

export function mergeConnectionEntry(
    file: Partial<HobbesConnectionsFile> | undefined,
    entry: { name: string; server: string; database?: string },
): HobbesConnectionsFile {
    const next: HobbesConnectionsFile = {
        DatabaseConnections: [...(file?.DatabaseConnections ?? [])],
        ServerConnections: [...(file?.ServerConnections ?? [])],
    };
    // Integrated auth only in this preview — credentials never enter the file.
    const connectionString =
        `Server=${entry.server};` +
        (entry.database ? `Database=${entry.database};` : "") +
        "Integrated Security=True;TrustServerCertificate=True;Encrypt=False";
    const record = {
        Name: entry.name,
        Description: "Added by MSSQL Runbook Studio.",
        ConnectionString: connectionString,
    };
    const bucket = entry.database ? next.DatabaseConnections : next.ServerConnections;
    const existing = bucket.findIndex((c) => c.Name === entry.name);
    if (existing >= 0) {
        bucket[existing] = record;
    } else {
        bucket.push(record);
    }
    return next;
}
