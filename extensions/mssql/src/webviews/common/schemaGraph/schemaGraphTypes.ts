/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider-neutral schema graph vocabulary (SV-R3; visualizer addendum
 * §10.2). The shared canvas/node components consume ONLY these plain
 * serializable shapes plus explicit callbacks — no page state context, no
 * event bus, no diff/change providers, no Copilot, no RPC (the exact
 * legacy entanglements A-12 flags). Any page (Schema Visualizer today,
 * Schema Designer after a later convergence) adapts its own model to
 * these types.
 */

export interface SchemaGraphColumnData {
    /** Stable column id (e.g. `column:<objectId>:<columnId>`). */
    id: string;
    name: string;
    typeDisplay: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    isForeignKey: boolean;
    isIdentity?: boolean;
    isComputed?: boolean;
}

/** React Flow node `data` for a schema graph table node. */
export interface SchemaGraphTableData extends Record<string, unknown> {
    /** Stable table id (e.g. `table:<objectId>`) — also the node id. */
    id: string;
    schema: string;
    name: string;
    columns: SchemaGraphColumnData[];
    /** Render de-emphasized (search/filter miss). */
    dimmed?: boolean;
}

/** React Flow edge `data` for an FK edge between table nodes. */
export interface SchemaGraphEdgeData extends Record<string, unknown> {
    /** Stable edge id (e.g. `fk:<constraintObjectId>`). */
    id: string;
    name: string;
    columnPairs: Array<{ fromColumnName: string; toColumnName: string }>;
    /** Display labels; "Unknown" means unknown — NEVER default NO_ACTION. */
    onDeleteLabel: string;
    onUpdateLabel: string;
}

/**
 * Columns beyond this render behind an expand toggle (legacy visual
 * parity; layout height still uses the FULL column count).
 */
export const SCHEMA_GRAPH_COLLAPSE_THRESHOLD = 10;

export interface ColumnSplit {
    visible: SchemaGraphColumnData[];
    hidden: SchemaGraphColumnData[];
    collapsible: boolean;
}

/** Pure collapse split — testable without React. */
export function splitColumnsForCollapse(
    columns: SchemaGraphColumnData[],
    collapsed: boolean,
    threshold: number = SCHEMA_GRAPH_COLLAPSE_THRESHOLD,
): ColumnSplit {
    const collapsible = columns.length > threshold;
    if (!collapsible || !collapsed) {
        return { visible: columns, hidden: [], collapsible };
    }
    return {
        visible: columns.slice(0, threshold),
        hidden: columns.slice(threshold),
        collapsible,
    };
}

/** Accessible label for a table node (screen-reader summary). */
export function schemaGraphTableAriaLabel(table: SchemaGraphTableData): string {
    return `${table.schema}.${table.name}, ${table.columns.length} columns`;
}

/** Accessible label for one column row. */
export function schemaGraphColumnAriaLabel(column: SchemaGraphColumnData): string {
    const facts: string[] = [column.typeDisplay];
    if (column.isPrimaryKey) {
        facts.push("primary key");
    }
    if (column.isForeignKey) {
        facts.push("foreign key");
    }
    if (!column.nullable) {
        facts.push("not null");
    }
    return `${column.name}, ${facts.join(", ")}`;
}
