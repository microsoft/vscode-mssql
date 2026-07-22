/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo } from "react";
import { type Edge, type Node, useNodesState } from "@xyflow/react";
import {
    RunbookSchemaGraphDocument,
    RunbookSchemaGraphRelationship,
    RunbookSchemaGraphTable,
} from "../../../sharedInterfaces/runbookSchemaGraph";
import { HostedResultApplication } from "../../common/HostedResultApplication/HostedResultApplication";
import {
    SchemaGraphCanvas,
    SCHEMA_GRAPH_TABLE_NODE_TYPE,
} from "../../common/schemaGraph/SchemaGraphCanvas";
import { layoutSchemaGraph } from "../../common/schemaGraph/schemaGraphLayout";
import { SchemaGraphTableData } from "../../common/schemaGraph/schemaGraphTypes";
import { locConstants } from "../../common/locConstants";

export function parseRunbookSchemaGraphDocument(
    raw: unknown,
): RunbookSchemaGraphDocument | undefined {
    if (typeof raw !== "string") {
        return undefined;
    }
    try {
        const value = JSON.parse(raw) as Partial<RunbookSchemaGraphDocument>;
        if (
            value.schemaVersion !== 1 ||
            typeof value.databaseLabel !== "string" ||
            !isCount(value.totalTables) ||
            !Array.isArray(value.tables) ||
            !value.tables.every(isGraphTable) ||
            !Array.isArray(value.relationships) ||
            !value.relationships.every(isGraphRelationship) ||
            !isCount(value.omittedTableCount) ||
            !isCount(value.omittedRelationshipCount) ||
            !isCount(value.danglingRelationshipCount) ||
            typeof value.truncated !== "boolean" ||
            !value.freshness ||
            typeof value.freshness.source !== "string" ||
            typeof value.freshness.freshness !== "string" ||
            typeof value.freshness.validation !== "string"
        ) {
            return undefined;
        }
        const ids = new Set(value.tables.map((table) => table.id));
        if (
            ids.size !== value.tables.length ||
            value.relationships.some(
                (relationship) =>
                    !ids.has(relationship.sourceTableId) || !ids.has(relationship.targetTableId),
            )
        ) {
            return undefined;
        }
        return value as RunbookSchemaGraphDocument;
    } catch {
        return undefined;
    }
}

export function SchemaGraphResultApplication({
    document,
}: {
    document: RunbookSchemaGraphDocument;
}) {
    const loc = locConstants.runbookStudio;
    const graph = useMemo(() => buildGraph(document), [document]);
    const [nodes, , onNodesChange] = useNodesState<Node<SchemaGraphTableData>>(graph.nodes);
    return (
        <HostedResultApplication
            ariaLabel={loc.schemaGraphResult}
            readOnlyLabel={loc.readOnlyChip}
            summary={loc.schemaGraphSummary(
                document.databaseLabel,
                document.tables.length,
                document.totalTables,
            )}>
            <div className="rbs-schema-graph-result">
                {document.truncated ? (
                    <div className="rbs-schema-graph-notice" role="status">
                        {loc.schemaGraphTruncated(
                            document.omittedTableCount,
                            document.omittedRelationshipCount,
                            document.danglingRelationshipCount,
                        )}
                    </div>
                ) : null}
                {nodes.length > 0 ? (
                    <div className="rbs-schema-graph-canvas">
                        <SchemaGraphCanvas
                            nodes={nodes}
                            edges={graph.edges}
                            onNodesChange={onNodesChange}
                        />
                    </div>
                ) : (
                    <div className="rbs-hosted-empty">{loc.schemaGraphEmpty}</div>
                )}
            </div>
        </HostedResultApplication>
    );
}

function buildGraph(document: RunbookSchemaGraphDocument): {
    nodes: Node<SchemaGraphTableData>[];
    edges: Edge[];
} {
    const positions = layoutSchemaGraph(
        document.tables.map((table) => ({ id: table.id, columnCount: table.columns.length })),
        document.relationships.map((relationship) => ({
            sourceId: relationship.sourceTableId,
            targetId: relationship.targetTableId,
        })),
    );
    return {
        nodes: document.tables.map((table) => ({
            id: table.id,
            type: SCHEMA_GRAPH_TABLE_NODE_TYPE,
            position: positions.get(table.id) ?? { x: 0, y: 0 },
            data: {
                id: table.id,
                schema: table.schema,
                name: table.name,
                columns: table.columns,
            },
        })),
        edges: document.relationships.map((relationship) => ({
            id: relationship.id,
            source: relationship.sourceTableId,
            target: relationship.targetTableId,
            data: {
                id: relationship.id,
                name: relationship.name,
                columnPairs: relationship.columnPairs,
                onDeleteLabel: relationship.onDeleteLabel,
                onUpdateLabel: relationship.onUpdateLabel,
            },
        })),
    };
}

function isGraphTable(value: unknown): value is RunbookSchemaGraphTable {
    if (!value || typeof value !== "object") {
        return false;
    }
    const table = value as Partial<RunbookSchemaGraphTable>;
    return (
        typeof table.id === "string" &&
        typeof table.schema === "string" &&
        typeof table.name === "string" &&
        isCount(table.totalColumns) &&
        Array.isArray(table.columns) &&
        table.columns.every(
            (column) =>
                column !== null &&
                typeof column === "object" &&
                typeof column.id === "string" &&
                typeof column.name === "string" &&
                typeof column.typeDisplay === "string" &&
                typeof column.nullable === "boolean" &&
                typeof column.isPrimaryKey === "boolean" &&
                typeof column.isForeignKey === "boolean" &&
                typeof column.isIdentity === "boolean" &&
                typeof column.isComputed === "boolean",
        ) &&
        typeof table.columnsTruncated === "boolean"
    );
}

function isGraphRelationship(value: unknown): value is RunbookSchemaGraphRelationship {
    if (!value || typeof value !== "object") {
        return false;
    }
    const relationship = value as Partial<RunbookSchemaGraphRelationship>;
    return (
        typeof relationship.id === "string" &&
        typeof relationship.name === "string" &&
        typeof relationship.sourceTableId === "string" &&
        typeof relationship.targetTableId === "string" &&
        Array.isArray(relationship.columnPairs) &&
        relationship.columnPairs.every(
            (pair) =>
                pair !== null &&
                typeof pair === "object" &&
                typeof pair.fromColumnName === "string" &&
                typeof pair.toColumnName === "string",
        ) &&
        typeof relationship.onDeleteLabel === "string" &&
        typeof relationship.onUpdateLabel === "string"
    );
}

function isCount(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}
