/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Plan graph view (mockup "runbook workflow" canvas): a readable node-graph
 * of the compiled plan rendered as pure inline SVG (CSP-safe — no graph
 * libraries). Topological layering from the entry node assigns columns
 * (BFS depth); nodes in a layer stack vertically; unreachable nodes park in
 * a final column so the layout is total. Edges draw as cubic beziers with an
 * arrowhead; conditional edges render dashed with a small label chip. When a
 * run snapshot is supplied, node borders/fills tint by live state and a
 * small state glyph appears. All colors ride VS Code theme tokens (CSS
 * classes on the SVG elements — see runbookStudio.css .rbs-graph-*).
 */

import { useEffect } from "react";
import { locConstants } from "../../common/locConstants";
import { perfMarkAfterNextPaint } from "../../common/perfMarks";
import {
    RunbookNodeSnapshot,
    RunbookNodeStateKind,
    RunbookPlanEdge,
    RunbookPlanNode,
    RunbookRunSnapshot,
} from "../../../sharedInterfaces/runbookStudio";

const NODE_W = 180;
const NODE_H = 64;
const COL_GAP = 90;
const ROW_GAP = 26;
const PAD = 16;
/** Truncation budgets sized to the fixed card width (full text in <title>). */
const LABEL_MAX_CHARS = 22;
const IDENTITY_MAX_CHARS = 27;

interface NodePosition {
    x: number;
    y: number;
}

interface GraphLayout {
    positions: Map<string, NodePosition>;
    width: number;
    height: number;
}

/** Topological layering: BFS depth from the entry node = column index; nodes
 *  in the same layer stack vertically in lock order; unreachable nodes go to
 *  a final column (total layout — every node renders somewhere). */
function layoutGraph(
    entryNodeId: string,
    nodes: RunbookPlanNode[],
    edges: RunbookPlanEdge[],
): GraphLayout {
    const ids = new Set(nodes.map((n) => n.id));
    const outgoing = new Map<string, string[]>();
    for (const edge of edges) {
        if (!ids.has(edge.from) || !ids.has(edge.to)) {
            continue;
        }
        const targets = outgoing.get(edge.from);
        if (targets) {
            targets.push(edge.to);
        } else {
            outgoing.set(edge.from, [edge.to]);
        }
    }
    const columnById = new Map<string, number>();
    if (ids.has(entryNodeId)) {
        columnById.set(entryNodeId, 0);
        const queue: string[] = [entryNodeId];
        while (queue.length > 0) {
            const current = queue.shift()!;
            const depth = columnById.get(current)!;
            for (const next of outgoing.get(current) ?? []) {
                if (!columnById.has(next)) {
                    columnById.set(next, depth + 1);
                    queue.push(next);
                }
            }
        }
    }
    let maxColumn = -1;
    for (const depth of columnById.values()) {
        maxColumn = Math.max(maxColumn, depth);
    }
    // Unreachable nodes park after the deepest reachable layer (column 0
    // when nothing is reachable at all).
    const unreachableColumn = maxColumn + 1;
    for (const node of nodes) {
        if (!columnById.has(node.id)) {
            columnById.set(node.id, unreachableColumn);
        }
    }
    const rowCounts = new Map<number, number>();
    const positions = new Map<string, NodePosition>();
    let columnCount = 0;
    let rowCount = 0;
    for (const node of nodes) {
        const column = columnById.get(node.id)!;
        const row = rowCounts.get(column) ?? 0;
        rowCounts.set(column, row + 1);
        positions.set(node.id, {
            x: PAD + column * (NODE_W + COL_GAP),
            y: PAD + row * (NODE_H + ROW_GAP),
        });
        columnCount = Math.max(columnCount, column + 1);
        rowCount = Math.max(rowCount, row + 1);
    }
    return {
        positions,
        width: PAD * 2 + columnCount * NODE_W + Math.max(0, columnCount - 1) * COL_GAP,
        height: PAD * 2 + rowCount * NODE_H + Math.max(0, rowCount - 1) * ROW_GAP,
    };
}

function truncate(text: string, maxChars: number): string {
    return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function stateGlyph(state: RunbookNodeStateKind): string {
    switch (state) {
        case "succeeded":
            return "✓";
        case "failed":
            return "✕";
        case "running":
            return "⟳";
        case "cancelled":
        case "skipped":
            return "⊘";
        case "awaitingApproval":
            return "⏸";
        default:
            return "○";
    }
}

function GraphEdge({
    edge,
    source,
    target,
}: {
    edge: RunbookPlanEdge;
    source: NodePosition;
    target: NodePosition;
}) {
    const x1 = source.x + NODE_W;
    const y1 = source.y + NODE_H / 2;
    const x2 = target.x;
    const y2 = target.y + NODE_H / 2;
    const bend = Math.max(36, Math.abs(x2 - x1) / 2);
    const path = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
    const routeLabel = edge.label ?? edge.when;
    const conditional = routeLabel !== undefined;
    // Cubic midpoint at t=0.5 collapses to the endpoint average for this
    // control-point choice — a stable anchor for the condition chip.
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const visibleRouteLabel = routeLabel ? truncate(routeLabel, 28) : undefined;
    const chipWidth = visibleRouteLabel ? visibleRouteLabel.length * 6 + 12 : 0;
    return (
        <g>
            {routeLabel ? <title>{routeLabel}</title> : null}
            <path
                className={`rbs-graph-edge ${conditional ? "rbs-graph-edge-conditional" : ""}`}
                d={path}
                markerEnd="url(#rbs-graph-arrowhead)"
            />
            {visibleRouteLabel ? (
                <g>
                    <rect
                        className="rbs-graph-edge-chip-bg"
                        x={midX - chipWidth / 2}
                        y={midY - 8}
                        width={chipWidth}
                        height={16}
                        rx={8}
                    />
                    <text
                        className="rbs-graph-edge-chip-text"
                        x={midX}
                        y={midY}
                        textAnchor="middle"
                        dominantBaseline="central">
                        {visibleRouteLabel}
                    </text>
                </g>
            ) : null}
        </g>
    );
}

function GraphNode({
    node,
    position,
    snapshot,
}: {
    node: RunbookPlanNode;
    position: NodePosition;
    snapshot: RunbookNodeSnapshot | undefined;
}) {
    const identity = node.runtime
        ? `Hobbes · ${node.runtime.nodeType}`
        : node.activityKind
          ? `${node.activityKind}@${node.activityVersion ?? 1}`
          : node.kind;
    const target = node.target
        ? ` — target ${node.target.kind} via ${
              node.target.binding.source === "parameter"
                  ? `$params.${node.target.binding.parameterId}`
                  : node.target.binding.source === "nodeOutput"
                    ? `$nodes.${node.target.binding.nodeId}.${node.target.binding.output}`
                    : "workspace"
          }`
        : "";
    const preview = node.previewOnly ? " — deterministic preview only" : "";
    return (
        <g className={`rbs-graph-node ${snapshot ? `rbs-graph-node-${snapshot.state}` : ""}`}>
            <title>{`${node.label} — ${identity}${target}${preview}${node.runtime?.description ? ` — ${node.runtime.description}` : ""}`}</title>
            <rect
                className="rbs-graph-node-rect"
                x={position.x}
                y={position.y}
                width={NODE_W}
                height={NODE_H}
                rx={6}
            />
            <rect
                className="rbs-graph-node-tint"
                x={position.x}
                y={position.y}
                width={NODE_W}
                height={NODE_H}
                rx={6}
            />
            <rect
                className={`rbs-graph-kindbar-${node.kind}`}
                x={position.x + 3}
                y={position.y + 3}
                width={4}
                height={NODE_H - 6}
                rx={2}
            />
            <text className="rbs-graph-label" x={position.x + 14} y={position.y + 26}>
                {truncate(node.label, LABEL_MAX_CHARS)}
            </text>
            <text className="rbs-graph-kind" x={position.x + 14} y={position.y + 44}>
                {truncate(identity, IDENTITY_MAX_CHARS)}
            </text>
            {snapshot ? (
                <text
                    className={`rbs-graph-glyph rbs-graph-glyph-${snapshot.state}`}
                    x={position.x + NODE_W - 14}
                    y={position.y + 18}
                    textAnchor="middle">
                    {stateGlyph(snapshot.state)}
                </text>
            ) : null}
        </g>
    );
}

export function PlanGraphView({
    entryNodeId,
    nodes,
    edges,
    run,
}: {
    entryNodeId: string;
    nodes: RunbookPlanNode[];
    edges: RunbookPlanEdge[];
    run?: RunbookRunSnapshot;
}) {
    const loc = locConstants.runbookStudio;
    useEffect(() => {
        if (nodes.length > 0) {
            perfMarkAfterNextPaint("mssql.runbookStudio.plan.renderComplete", {
                nodeCount: nodes.length,
            });
        }
    }, [nodes.length]);
    if (nodes.length === 0) {
        // Total layout rule: never a blank panel.
        return (
            <div className="rbs-empty">
                <div className="rbs-empty-title">{loc.noCompiledPlanTitle}</div>
                <div className="rbs-empty-detail">{loc.notCompiledDetail}</div>
            </div>
        );
    }
    const { positions, width, height } = layoutGraph(entryNodeId, nodes, edges);
    const stateByNode = new Map<string, RunbookNodeSnapshot>(
        (run?.nodes ?? []).map((n) => [n.nodeId, n]),
    );
    const drawableEdges = edges.filter((e) => positions.has(e.from) && positions.has(e.to));
    return (
        <div className="rbs-graph-scroll">
            <svg
                className="rbs-graph-svg"
                width={width}
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-label={loc.graphAriaSummary(nodes.length, drawableEdges.length)}>
                <defs>
                    <marker
                        id="rbs-graph-arrowhead"
                        viewBox="0 0 8 8"
                        refX={7}
                        refY={4}
                        markerWidth={7}
                        markerHeight={7}
                        orient="auto-start-reverse">
                        <path className="rbs-graph-arrow" d="M0 0 L8 4 L0 8 Z" />
                    </marker>
                </defs>
                {drawableEdges.map((edge, index) => (
                    <GraphEdge
                        key={`${edge.from}->${edge.to}:${edge.label ?? ""}:${edge.when ?? ""}:${index}`}
                        edge={edge}
                        source={positions.get(edge.from)!}
                        target={positions.get(edge.to)!}
                    />
                ))}
                {nodes.map((node) => (
                    <GraphNode
                        key={node.id}
                        node={node}
                        position={positions.get(node.id)!}
                        snapshot={stateByNode.get(node.id)}
                    />
                ))}
            </svg>
        </div>
    );
}
