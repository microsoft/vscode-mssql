/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Provider-neutral, bounded schema graph retained by Runbook Studio. This is
 * deliberately smaller than the editable Schema Visualizer catalog model:
 * run results need stable diagram facts, not live-session or publish state.
 */

export const RUNBOOK_SCHEMA_GRAPH_DOCUMENT_SCHEMA_VERSION = 1 as const;

export interface RunbookSchemaGraphColumn {
    id: string;
    name: string;
    typeDisplay: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    isForeignKey: boolean;
    isIdentity: boolean;
    isComputed: boolean;
}

export interface RunbookSchemaGraphTable {
    id: string;
    schema: string;
    name: string;
    totalColumns: number;
    columns: RunbookSchemaGraphColumn[];
    columnsTruncated: boolean;
}

export interface RunbookSchemaGraphRelationship {
    id: string;
    name: string;
    sourceTableId: string;
    targetTableId: string;
    columnPairs: Array<{ fromColumnName: string; toColumnName: string }>;
    onDeleteLabel: string;
    onUpdateLabel: string;
}

export interface RunbookSchemaGraphDocument {
    schemaVersion: typeof RUNBOOK_SCHEMA_GRAPH_DOCUMENT_SCHEMA_VERSION;
    databaseLabel: string;
    totalTables: number;
    tables: RunbookSchemaGraphTable[];
    relationships: RunbookSchemaGraphRelationship[];
    omittedTableCount: number;
    omittedRelationshipCount: number;
    danglingRelationshipCount: number;
    truncated: boolean;
    freshness: {
        source: string;
        freshness: string;
        validation: string;
    };
    provider: {
        /** Diagnostic identity only. Consumers must not branch on it. */
        kind: string;
        contractVersion: number;
    };
}
