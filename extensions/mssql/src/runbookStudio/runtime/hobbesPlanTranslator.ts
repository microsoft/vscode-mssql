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
 *   - assert.threshold -> primitive:assert.threshold (literals pass through,
 *     $params.<id> substitutes the bound run value, $nodes.<id>.<key> maps
 *     to the runtime's $regions.<id>.data.<key> bind grammar)
 *   - report          -> Report node with deterministic reportSections
 *   - gates and conditional edges are not translated yet (issues returned;
 *     publish is refused).
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

/** One hour: a demo-friendly ceiling far under the primitive's 24h max. */
const GATE_TIMEOUT_SECONDS = 3_600;

/** Wait-signal correlation key for a gate node (adapter addresses the
 *  wait record with this on approve). */
export function gateCorrelationKey(nodeId: string): string {
    return `gate:${nodeId}`;
}

function isLiteral(value: unknown): value is string | number | boolean {
    if (typeof value === "number" || typeof value === "boolean") {
        return true;
    }
    return typeof value === "string" && !value.startsWith("$");
}

/**
 * Resolve one assert input for publishing:
 *  - literals pass through;
 *  - `$params.<id>` substitutes the bound run value (publish happens per
 *    run, so per-run substitution is exact);
 *  - `$nodes.<id>.<key>` maps to the runtime's cross-node bind grammar
 *    `$regions.<id>.data.<key>` (verified against the runtime's own
 *    PrimitivePlanSmokeTests; sql.execute-query data carries rowCount).
 */
function resolveAssertInput(
    value: unknown,
    parameterValues: Record<string, string | number | boolean | null>,
): { ok: true; value: unknown } | { ok: false; detail: string } {
    if (isLiteral(value)) {
        return { ok: true, value };
    }
    if (typeof value !== "string") {
        return { ok: false, detail: `unsupported input ${JSON.stringify(value)}` };
    }
    const param = /^\$params\.([A-Za-z0-9_-]+)$/.exec(value);
    if (param) {
        const bound = parameterValues[param[1]];
        if (bound === undefined || bound === null) {
            return { ok: false, detail: `parameter '${param[1]}' has no bound value` };
        }
        const numeric = typeof bound === "string" ? Number(bound) : bound;
        return {
            ok: true,
            value: typeof numeric === "number" && !Number.isNaN(numeric) ? numeric : bound,
        };
    }
    const node = /^\$nodes\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)$/.exec(value);
    if (node) {
        return { ok: true, value: `$regions.${node[1]}.data.${node[2]}` };
    }
    return { ok: false, detail: `bind expression '${value}' has no Hobbes translation` };
}

export function translateArtifactToHobbesPlan(
    artifact: RunbookArtifactFile,
    parameterValues: Record<string, string | number | boolean | null> = {},
): TranslationResult {
    const issues: string[] = [];
    const lock = artifact.lock;
    if (!lock) {
        return { issues: ["artifact has no compiled lock"] };
    }
    // Effective values = declared parameter defaults overlaid by this run's
    // bound values (secrets never declare defaults, enforced at parse time).
    const effectiveValues: Record<string, string | number | boolean | null> = {};
    for (const parameter of artifact.source.parameters) {
        if (parameter.default !== undefined) {
            effectiveValues[parameter.id] = parameter.default;
        }
    }
    for (const [key, value] of Object.entries(parameterValues)) {
        if (value !== undefined && value !== null) {
            effectiveValues[key] = value;
        }
    }
    for (const edge of lock.edges) {
        // "approved" maps to the wait.signal resume path (approval = the
        // resume payload); "success" is the plain edge. Failure/rejected
        // branches have no runtime translation yet — refuse honestly.
        if (edge.when !== undefined && edge.when !== "success" && edge.when !== "approved") {
            issues.push(
                `conditional edge ${edge.from}->${edge.to} [${edge.when}] is not publishable yet`,
            );
        }
    }

    const nodes: HobbesPlanNode[] = [];
    for (const node of lock.nodes) {
        if (node.kind === "gate") {
            // Gates publish as the runtime's SUSPENDABLE wait.signal
            // primitive: the workflow genuinely stops (executionStatus
            // "waiting-signal"); approve = POST resume + trigger-resume,
            // reject = cancel. Correlation key is derived from the node id
            // so the adapter can address the wait record.
            nodes.push({
                id: node.id,
                type: "Observation",
                strategy: "primitive:wait.signal",
                primitiveArgs: {
                    correlationKey: gateCorrelationKey(node.id),
                    // v1 primitive accepts only this kind; the approval
                    // resolves via /api/wait-signals resume, not an actual
                    // monitor incident (verified: kind is validated, the
                    // resume path is kind-agnostic).
                    signalKind: "monitor-incident",
                    timeoutSeconds: GATE_TIMEOUT_SECONDS,
                },
                outputKey: node.id,
            });
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
                const value = resolveAssertInput(node.inputs?.value, effectiveValues);
                const max = resolveAssertInput(node.inputs?.max, effectiveValues);
                if (!value.ok || !max.ok) {
                    issues.push(
                        `node '${node.id}': ${[value, max]
                            .filter((r): r is { ok: false; detail: string } => !r.ok)
                            .map((r) => r.detail)
                            .join("; ")}`,
                    );
                    continue;
                }
                nodes.push({
                    id: node.id,
                    type: "Observation",
                    strategy: "primitive:assert.threshold",
                    primitiveArgs: {
                        metric: value.value,
                        threshold: max.value,
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
