/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runtime-planner plan IR -> compiled artifact lock (R1.2, D-0010). The
 * Hobbes planner (`POST /api/runbooks/from-prompt`) authors the full plan
 * and saves it in the runtime library as a draft; this module maps that
 * plan IR into the artifact's lock vocabulary so the editor renders it,
 * and stamps `libraryAssetRef` so the hobbes lane launches the library
 * asset directly — the lock is NEVER translated back into runtime IR.
 * Pure module: no vscode API usage (unit-tested directly).
 */

import { RunbookStudio as LocRunbookStudio } from "../../constants/locConstants";
import {
    RunbookArtifactFile,
    RunbookParameterDefinition,
    RunbookPlanEdge,
    RunbookPlanNode,
    RUNBOOK_LOCK_SCHEMA_VERSION,
} from "../../sharedInterfaces/runbookStudio";
import {
    canonicalizeRunbookArtifact,
    computePlanHash,
    createNewRunbookArtifact,
    isArtifactParseFailure,
    parseRunbookArtifact,
} from "../runbookArtifact";

/** One node of the runtime planner's plan IR (boundary projection). */
export interface PlannerPlanNode {
    id: string;
    /** Runtime IR node type, e.g. "Observation", "Report", "Decision". */
    type?: string;
    /** Runtime IR role, e.g. "observation", "report". */
    role?: string;
    /** Execution strategy, e.g. "primitive:mcp:sql-copilot:mssql_execute_read_query". */
    strategy?: string;
    primitiveArgs?: Record<string, unknown>;
    metadata?: { title?: string; description?: string };
    branches?: Array<{
        branchKey?: string;
        label: string;
        targetNodeIds: string[];
        expression?: string;
    }>;
    defaultTargetNodeId?: string;
    branchNodeIds?: string[];
    fanInTargetNodeId?: string;
    reason?: string;
    approvalKind?: string;
    onApprove?: string;
    onReject?: string;
}

export interface PlannerPlanEdge {
    from: string;
    to: string;
    label?: string;
}

/** The planner session's terminal result, mapped by the adapter. */
export interface PlannedRunbook {
    /** Runtime library asset id — the asset is ALREADY saved as a draft. */
    assetId: string;
    /** Optimistic-concurrency identity of the saved draft head. */
    revisionId?: string;
    /** Asset version label, when known (library-import path only — the
     *  planner session does not report one). */
    versionLabel?: string;
    title: string;
    plan: {
        nodes: PlannerPlanNode[];
        edges: PlannerPlanEdge[];
        entryNodeId?: string;
    };
    inputSchema: Array<{ name: string; kind: string }>;
}

export type PlannedArtifactResult =
    | { ok: true; artifact: RunbookArtifactFile }
    | { ok: false; detail: string };

/** Narrowing helper (non-strict tsconfig: boolean discriminants don't narrow). */
export function isPlannedArtifactFailure(
    result: PlannedArtifactResult,
): result is { ok: false; detail: string } {
    return !result.ok;
}

/** A library reference is the one-way execution-authority marker even when
 * every runtime node happens to map to a native SQL/report projection. */
export function hasRuntimeLibraryAuthority(artifact: RunbookArtifactFile): boolean {
    return artifact.lock?.libraryAssetRef !== undefined;
}

/** kebab-case node id -> spaced, first-letter-capitalized label. */
export function humanizeNodeId(id: string): string {
    const spaced = id.split("-").filter(Boolean).join(" ");
    if (spaced.length === 0) {
        return id;
    }
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isSqlReadStrategy(strategy: string | undefined): boolean {
    return (
        typeof strategy === "string" &&
        (strategy.includes("mssql_execute_read_query") ||
            strategy === "primitive:sql.execute-query")
    );
}

function isReportNode(node: PlannerPlanNode): boolean {
    return (
        (node.type ?? "").toLowerCase() === "report" || (node.role ?? "").toLowerCase() === "report"
    );
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nonEmptyStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const values = value.flatMap((entry) => {
        const text = nonEmptyString(entry);
        return text === undefined ? [] : [text];
    });
    return values.length > 0 ? values : undefined;
}

/** Project one untrusted runtime-plan node into the bounded fields the native
 * editor understands. Unknown runtime fields are deliberately not retained. */
export function projectPlannerNode(value: unknown): PlannerPlanNode | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const id = nonEmptyString(value.id);
    if (id === undefined) {
        return undefined;
    }
    const type = nonEmptyString(value.type);
    const role = nonEmptyString(value.role);
    const strategy = nonEmptyString(value.strategy);
    const metadataRaw = isRecord(value.metadata) ? value.metadata : undefined;
    const title = nonEmptyString(metadataRaw?.title);
    const description = nonEmptyString(metadataRaw?.description);
    const branches = Array.isArray(value.branches)
        ? value.branches.flatMap((candidate) => {
              if (!isRecord(candidate)) {
                  return [];
              }
              const label = nonEmptyString(candidate.label);
              const legacyTargetNodeId = nonEmptyString(candidate.targetNodeId);
              const targetNodeIds =
                  nonEmptyStringArray(candidate.targetNodeIds) ??
                  (legacyTargetNodeId ? [legacyTargetNodeId] : undefined);
              if (label === undefined || targetNodeIds === undefined) {
                  return [];
              }
              const branchKey = nonEmptyString(candidate.branchKey);
              const expression = nonEmptyString(candidate.expression);
              return [
                  {
                      ...(branchKey !== undefined ? { branchKey } : {}),
                      label,
                      targetNodeIds,
                      ...(expression !== undefined ? { expression } : {}),
                  },
              ];
          })
        : undefined;
    const branchNodeIds = nonEmptyStringArray(value.branchNodeIds);
    const defaultTargetNodeId = nonEmptyString(value.defaultTargetNodeId);
    const fanInTargetNodeId = nonEmptyString(value.fanInTargetNodeId);
    const reason = nonEmptyString(value.reason);
    const approvalKind = nonEmptyString(value.approvalKind);
    const onApprove = nonEmptyString(value.onApprove);
    const onReject = nonEmptyString(value.onReject);
    return {
        id,
        ...(type !== undefined ? { type } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(strategy !== undefined ? { strategy } : {}),
        ...(isRecord(value.primitiveArgs) ? { primitiveArgs: value.primitiveArgs } : {}),
        ...(title !== undefined || description !== undefined
            ? {
                  metadata: {
                      ...(title !== undefined ? { title } : {}),
                      ...(description !== undefined ? { description } : {}),
                  },
              }
            : {}),
        ...(branches !== undefined && branches.length > 0 ? { branches } : {}),
        ...(defaultTargetNodeId !== undefined ? { defaultTargetNodeId } : {}),
        ...(branchNodeIds !== undefined ? { branchNodeIds } : {}),
        ...(fanInTargetNodeId !== undefined ? { fanInTargetNodeId } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(approvalKind !== undefined ? { approvalKind } : {}),
        ...(onApprove !== undefined ? { onApprove } : {}),
        ...(onReject !== undefined ? { onReject } : {}),
    };
}

/** Project one untrusted runtime edge. Labels are descriptive; executable
 * conditions are derived only from typed Approval routes below. */
export function projectPlannerEdge(value: unknown): PlannerPlanEdge | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const from = nonEmptyString(value.from);
    const to = nonEmptyString(value.to);
    if (from === undefined || to === undefined) {
        return undefined;
    }
    const label = nonEmptyString(value.label);
    return { from, to, ...(label !== undefined ? { label } : {}) };
}

function runtimeSemantics(node: PlannerPlanNode): RunbookPlanNode["runtime"] | undefined {
    const nodeType = nonEmptyString(node.type);
    if (nodeType === undefined) {
        return undefined;
    }
    const normalized = nodeType.toLowerCase();
    const decision =
        normalized === "decision" && node.branches && node.branches.length > 0
            ? {
                  branches: node.branches,
                  ...(node.defaultTargetNodeId
                      ? { defaultTargetNodeId: node.defaultTargetNodeId }
                      : {}),
              }
            : undefined;
    const parallel =
        normalized === "parallel" && node.branchNodeIds && node.branchNodeIds.length > 0
            ? {
                  branchNodeIds: node.branchNodeIds,
                  ...(node.fanInTargetNodeId ? { fanInTargetNodeId: node.fanInTargetNodeId } : {}),
              }
            : undefined;
    const approval =
        normalized === "approval" && node.reason && node.approvalKind && node.onApprove
            ? {
                  reason: node.reason,
                  approvalKind: node.approvalKind,
                  onApprove: node.onApprove,
                  ...(node.onReject ? { onReject: node.onReject } : {}),
              }
            : undefined;
    return {
        nodeType,
        ...(node.role ? { role: node.role } : {}),
        ...(node.metadata?.description ? { description: node.metadata.description } : {}),
        ...(decision ? { decision } : {}),
        ...(parallel ? { parallel } : {}),
        ...(approval ? { approval } : {}),
    };
}

function mappedEdge(
    edge: PlannerPlanEdge,
    nodesById: ReadonlyMap<string, PlannerPlanNode>,
): RunbookPlanEdge {
    const approval = runtimeSemantics(nodesById.get(edge.from) ?? { id: edge.from })?.approval;
    const when =
        approval?.onApprove === edge.to
            ? "approved"
            : approval?.onReject === edge.to
              ? "rejected"
              : undefined;
    return {
        from: edge.from,
        to: edge.to,
        ...(edge.label ? { label: edge.label } : {}),
        ...(when ? { when } : {}),
    };
}

/**
 * Map ONE planner plan-IR node onto the lock vocabulary:
 *   - SQL read strategies -> "sql.query.read" activity (the editor's plan
 *     stepper shows the query; the runtime still executes its own IR).
 *   - Report nodes -> "report".
 *   - Everything else -> "hobbes.native" activity carrying the strategy,
 *     honest about being runtime-executed (no catalog admission claimed).
 */
export function mapPlannerNodeToLockNode(
    node: PlannerPlanNode,
    connectionParamId: string,
): RunbookPlanNode {
    const runtime = runtimeSemantics(node);
    const authoredTitle = node.metadata?.title;
    if (isSqlReadStrategy(node.strategy)) {
        const args = node.primitiveArgs ?? {};
        // The runtime's own primitive carries the statement as "query";
        // the MCP execute-read-query strategy carries it as "sql".
        const sql = nonEmptyString(args.query) ?? nonEmptyString(args.sql) ?? "";
        return {
            id: node.id,
            label: authoredTitle ?? nonEmptyString(args.queryDescription) ?? node.id,
            kind: "activity",
            activityKind: "sql.query.read",
            activityVersion: 1,
            inputs: { connection: `$params.${connectionParamId}`, sql },
            target: {
                kind: "sqlDatabase",
                binding: { source: "parameter", parameterId: connectionParamId },
            },
            ...(runtime ? { runtime } : {}),
        };
    }
    if (isReportNode(node)) {
        return {
            id: node.id,
            label: authoredTitle ?? humanizeNodeId(node.id),
            kind: "report",
            ...(runtime ? { runtime } : {}),
        };
    }
    return {
        id: node.id,
        label: authoredTitle ?? humanizeNodeId(node.id),
        kind: "activity",
        activityKind: "hobbes.native",
        activityVersion: 1,
        inputs: {
            strategy: nonEmptyString(node.strategy) ?? nonEmptyString(node.type) ?? "unknown",
        },
        target: {
            kind: "sqlDatabase",
            binding: { source: "parameter", parameterId: connectionParamId },
        },
        ...(runtime ? { runtime } : {}),
    };
}

/**
 * Build the compiled artifact for a planner result, mirroring the catalog
 * compiler's semantics exactly: plan-revision bump, canonical plan hash,
 * and structural validation through the SAME artifact parser the editor
 * trusts. Catalog admission is deliberately NOT applied — planner plans
 * carry "hobbes.native" nodes and run only via their library asset.
 */
export function buildPlannedArtifact(
    base: RunbookArtifactFile,
    intent: string,
    planned: PlannedRunbook,
): PlannedArtifactResult {
    if (planned.plan.nodes.length === 0) {
        return { ok: false, detail: "planner produced no plan nodes" };
    }

    // One connection parameter, derived from the planner's typed input
    // schema; an existing artifact parameter with the same id is kept
    // as-is (preserves user-authored labels/defaults across recompiles).
    const connectionInput = planned.inputSchema.find((input) => input.kind === "connection");
    const connectionParamId = connectionInput?.name ?? "database";
    const existingParameter = base.source.parameters.find(
        (parameter) => parameter.id === connectionParamId,
    );
    const parameters: RunbookParameterDefinition[] = [
        existingParameter ?? {
            id: connectionParamId,
            label: LocRunbookStudio.targetConnectionLabel,
            type: "connection",
            required: true,
        },
    ];

    const nodes = planned.plan.nodes.map((node) =>
        mapPlannerNodeToLockNode(node, connectionParamId),
    );
    const plannerNodesById = new Map(planned.plan.nodes.map((node) => [node.id, node]));
    const edges: RunbookPlanEdge[] = planned.plan.edges.map((edge) =>
        mappedEdge(edge, plannerNodesById),
    );

    const previousRevision = Number(base.lock?.planRevision ?? "0");
    const planRevision = String(Number.isFinite(previousRevision) ? previousRevision + 1 : 1);

    const candidate: RunbookArtifactFile = {
        ...base,
        // Adopt the planner's title only while the runbook is unnamed.
        name:
            base.name && base.name !== LocRunbookStudio.newRunbookName
                ? base.name
                : planned.title || base.name,
        source: {
            ...base.source,
            intent,
            parameters,
            ...(base.source.requirements
                ? {
                      requirements: {
                          ...base.source.requirements,
                          activities: base.source.requirements.activities.map((activity) => ({
                              ...activity,
                              host: "hobbes" as const,
                          })),
                      },
                  }
                : {}),
        },
        lock: {
            schemaVersion: RUNBOOK_LOCK_SCHEMA_VERSION,
            planRevision,
            planHash: "sha256:pending",
            entryNodeId: planned.plan.entryNodeId ?? nodes[0].id,
            nodes,
            edges,
            libraryAssetRef: {
                assetId: planned.assetId,
                ...(planned.versionLabel ? { versionLabel: planned.versionLabel } : {}),
            },
        },
    };
    candidate.lock!.planHash = computePlanHash(candidate.source, candidate.lock!);

    // Structural validation through the SAME parser the editor trusts.
    const structural = parseRunbookArtifact(canonicalizeRunbookArtifact(candidate));
    if (isArtifactParseFailure(structural)) {
        return { ok: false, detail: structural.detail };
    }
    return { ok: true, artifact: structural.artifact };
}

// ---------------------------------------------------------------------------
// Library interop (D-0012): outside-authored runtime assets -> artifact
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Runtime library category -> artifact family, only when it names one of
 *  the closed family values (case-insensitive); anything else is omitted —
 *  the artifact's family enum is closed and never guessed. */
function familyFromCategory(
    category: string | undefined,
): RunbookArtifactFile["family"] | undefined {
    const normalized = category?.trim().toLowerCase();
    return normalized === "build" ||
        normalized === "validate" ||
        normalized === "investigate" ||
        normalized === "composed"
        ? normalized
        : undefined;
}

/**
 * Build a complete compiled artifact from a RAW runtime library asset
 * (`GET /api/runbooks/{id}`) — the import path for runbooks authored
 * OUTSIDE VS Code (e.g. the Hobbes standalone frontend), which have no
 * publish-time stash to round-trip. The plan IR flows through the SAME
 * node/edge mapping and structural validation as the planner authoring
 * path; the lock references the library asset (+ version label) so the
 * hobbes lane launches it directly and never translates the lock. The
 * intent falls back sourcePromptText -> description -> title. Boundary
 * tolerant: malformed nodes/edges are dropped (ids are never invented);
 * an asset without an id or without plan nodes refuses with the exact
 * reason. Returns a failure result — never throws.
 */
export function buildArtifactFromLibraryAsset(
    asset: Record<string, unknown>,
): PlannedArtifactResult {
    const assetId = nonEmptyString(asset.id);
    if (assetId === undefined) {
        return { ok: false, detail: "library asset has no id" };
    }
    const title = nonEmptyString(asset.title) ?? assetId;

    const plan = isRecord(asset.plan) ? asset.plan : undefined;
    const rawNodes = plan !== undefined && Array.isArray(plan.nodes) ? plan.nodes : [];
    const rawEdges = plan !== undefined && Array.isArray(plan.edges) ? plan.edges : [];
    const nodes: PlannerPlanNode[] = [];
    for (const entry of rawNodes) {
        const projected = projectPlannerNode(entry);
        if (projected !== undefined) {
            nodes.push(projected);
        }
    }
    if (nodes.length === 0) {
        return { ok: false, detail: "library asset has no plan nodes" };
    }
    const edges: PlannerPlanEdge[] = [];
    for (const entry of rawEdges) {
        const projected = projectPlannerEdge(entry);
        if (projected !== undefined) {
            edges.push(projected);
        }
    }
    const inputSchema: Array<{ name: string; kind: string }> = [];
    for (const entry of Array.isArray(asset.inputSchema) ? asset.inputSchema : []) {
        if (!isRecord(entry)) {
            continue;
        }
        const name = nonEmptyString(entry.name);
        const kind = nonEmptyString(entry.kind);
        if (name !== undefined && kind !== undefined) {
            inputSchema.push({ name, kind });
        }
    }

    const description = nonEmptyString(asset.description);
    const family = familyFromCategory(nonEmptyString(asset.category));
    const versionLabel = nonEmptyString(asset.versionLabel);
    const entryNodeId = plan === undefined ? undefined : nonEmptyString(plan.entryNodeId);

    const base = createNewRunbookArtifact(title, assetId);
    if (description !== undefined) {
        base.description = description;
    }
    if (family !== undefined) {
        base.family = family;
    }
    const intent = nonEmptyString(asset.sourcePromptText) ?? description ?? title;
    return buildPlannedArtifact(base, intent, {
        assetId,
        ...(versionLabel !== undefined ? { versionLabel } : {}),
        title,
        plan: {
            nodes,
            edges,
            ...(entryNodeId !== undefined ? { entryNodeId } : {}),
        },
        inputSchema,
    });
}
