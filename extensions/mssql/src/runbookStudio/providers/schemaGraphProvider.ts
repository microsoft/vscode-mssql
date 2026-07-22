/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook adapter over the MetadataStore-native Schema Visualizer session.
 * This read path is STS v2 only. The live catalog model is projected into a
 * bounded, provider-neutral result before it crosses into retained run data.
 */

import { SchemaVisualizerSession } from "../../schemaVisualizer/schemaVisualizerSession";
import { projectGraph } from "../../schemaVisualizer/model/visualizerToGraphProjection";
import { MetadataStore } from "../../services/metadata/metadataStore";
import { PreparedConnection } from "../../services/metadata/profileAuthAdapter";
import {
    RUNBOOK_SCHEMA_GRAPH_DOCUMENT_SCHEMA_VERSION,
    RunbookSchemaGraphDocument,
} from "../../sharedInterfaces/runbookSchemaGraph";
import {
    RUNBOOK_SCHEMA_FINGERPRINT_SCHEMA_VERSION,
    RunbookSchemaFingerprintDocument,
} from "../../sharedInterfaces/runbookSchemaFingerprint";

export const RUNBOOK_SCHEMA_GRAPH_MAX_TABLES = 100;
export const RUNBOOK_SCHEMA_GRAPH_MAX_COLUMNS_PER_TABLE = 40;
export const RUNBOOK_SCHEMA_GRAPH_MAX_RELATIONSHIPS = 300;
export const RUNBOOK_SCHEMA_GRAPH_MAX_COLUMN_PAIRS = 16;

export interface RunbookSchemaGraphProviderRequest {
    prepared: PreparedConnection;
    database: string;
    isCancellationRequested: () => boolean;
}

export class RunbookSchemaGraphProviderError extends Error {
    constructor(
        message: string,
        public readonly code: "cancelled" | "metadataUnavailable",
    ) {
        super(message);
        this.name = "RunbookSchemaGraphProviderError";
    }
}

export class MetadataStoreRunbookSchemaGraphProvider {
    constructor(private readonly store: MetadataStore) {}

    async visualize(
        request: RunbookSchemaGraphProviderRequest,
    ): Promise<RunbookSchemaGraphDocument> {
        throwIfCancelled(request);
        const session = new SchemaVisualizerSession(this.store, {
            prepared: request.prepared,
            database: request.database,
        });
        try {
            const initial = await session.getModel();
            throwIfCancelled(request);
            let selected = initial;
            if (initial.totalTables > RUNBOOK_SCHEMA_GRAPH_MAX_TABLES) {
                const objectIds =
                    initial.model.tables.length > 0
                        ? initial.model.tables
                              .slice(0, RUNBOOK_SCHEMA_GRAPH_MAX_TABLES)
                              .map((table) => table.identity.objectId)
                        : (await session.searchTables("", RUNBOOK_SCHEMA_GRAPH_MAX_TABLES)).map(
                              (table) => table.objectId,
                          );
                throwIfCancelled(request);
                selected = await session.getModel({ objectIds });
                throwIfCancelled(request);
            }
            return projectRunbookSchemaGraphDocument(selected, initial.totalTables);
        } catch (error) {
            if (error instanceof RunbookSchemaGraphProviderError) {
                throw error;
            }
            throw new RunbookSchemaGraphProviderError(
                error instanceof Error ? error.message : "Schema metadata is unavailable.",
                "metadataUnavailable",
            );
        } finally {
            session.dispose();
        }
    }

    /** Force one live STS v2 refresh and retain only its complete-catalog
     * identity. The visualizer session computes the fingerprint from the
     * full model even when its render payload is search-first. */
    async fingerprint(
        request: RunbookSchemaGraphProviderRequest,
    ): Promise<RunbookSchemaFingerprintDocument> {
        throwIfCancelled(request);
        const session = new SchemaVisualizerSession(this.store, {
            prepared: request.prepared,
            database: request.database,
        });
        try {
            const result = await session.refresh();
            throwIfCancelled(request);
            return {
                schemaVersion: RUNBOOK_SCHEMA_FINGERPRINT_SCHEMA_VERSION,
                databaseLabel: request.database,
                schemaSha256: result.fingerprint,
                complete: result.fingerprintComplete,
                tableCount: result.totalTables,
                capturedAtUtc: new Date().toISOString(),
                freshness: { ...result.freshness },
                provider: { kind: "sts-v2-metadata-store", contractVersion: 2 },
            };
        } catch (error) {
            if (error instanceof RunbookSchemaGraphProviderError) {
                throw error;
            }
            throw new RunbookSchemaGraphProviderError(
                error instanceof Error ? error.message : "Schema metadata is unavailable.",
                "metadataUnavailable",
            );
        } finally {
            session.dispose();
        }
    }
}

export function projectRunbookSchemaGraphDocument(
    result: Awaited<ReturnType<SchemaVisualizerSession["getModel"]>>,
    totalTables: number = result.totalTables,
): RunbookSchemaGraphDocument {
    const projection = projectGraph(result.model);
    const tables = projection.nodes.slice(0, RUNBOOK_SCHEMA_GRAPH_MAX_TABLES).map((table) => ({
        id: table.id,
        schema: table.schema,
        name: table.name,
        totalColumns: table.columns.length,
        columns: table.columns
            .slice(0, RUNBOOK_SCHEMA_GRAPH_MAX_COLUMNS_PER_TABLE)
            .map((column) => ({ ...column })),
        columnsTruncated: table.columns.length > RUNBOOK_SCHEMA_GRAPH_MAX_COLUMNS_PER_TABLE,
    }));
    const tableIds = new Set(tables.map((table) => table.id));
    const eligibleRelationships = projection.edges.filter(
        (edge) => tableIds.has(edge.sourceNodeId) && tableIds.has(edge.targetNodeId),
    );
    const relationships = eligibleRelationships
        .slice(0, RUNBOOK_SCHEMA_GRAPH_MAX_RELATIONSHIPS)
        .map((edge) => ({
            id: edge.id,
            name: edge.name,
            sourceTableId: edge.sourceNodeId,
            targetTableId: edge.targetNodeId,
            columnPairs: edge.columnPairs.slice(0, RUNBOOK_SCHEMA_GRAPH_MAX_COLUMN_PAIRS),
            onDeleteLabel: edge.onDeleteLabel,
            onUpdateLabel: edge.onUpdateLabel,
        }));
    const omittedTableCount = Math.max(0, totalTables - tables.length);
    const omittedRelationshipCount = Math.max(
        0,
        eligibleRelationships.length - relationships.length,
    );
    const danglingRelationshipCount = projection.danglingEdges.length;
    return {
        schemaVersion: RUNBOOK_SCHEMA_GRAPH_DOCUMENT_SCHEMA_VERSION,
        databaseLabel: result.model.databaseIdentity.database,
        totalTables,
        tables,
        relationships,
        omittedTableCount,
        omittedRelationshipCount,
        danglingRelationshipCount,
        truncated:
            omittedTableCount > 0 ||
            omittedRelationshipCount > 0 ||
            danglingRelationshipCount > 0 ||
            tables.some((table) => table.columnsTruncated),
        freshness: { ...result.freshness },
        provider: { kind: "sts-v2-metadata-store", contractVersion: 2 },
    };
}

function throwIfCancelled(request: RunbookSchemaGraphProviderRequest): void {
    if (request.isCancellationRequested()) {
        throw new RunbookSchemaGraphProviderError(
            "Schema visualization was cancelled.",
            "cancelled",
        );
    }
}
