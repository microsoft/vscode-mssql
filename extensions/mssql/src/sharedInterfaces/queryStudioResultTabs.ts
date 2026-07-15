/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { QsResultSetSummary } from "./queryStudio";

export interface QueryStudioVectorColumnCandidate {
    readonly resultSetId: string;
    readonly columnOrdinal: number;
    readonly columnName: string;
    readonly dimensions?: number;
    readonly transport: "binary-v1" | "textFallback";
}

export interface QueryStudioSpatialColumnCandidate {
    readonly resultSetId: string;
    readonly resultSetLabel: string;
    readonly columnOrdinal: number;
    readonly columnName: string;
    readonly kind: "geometry" | "geography";
    /** Row count from the coarse summary; the shell overlays live counts separately. */
    readonly summaryRowCount: number;
    /** Shared by every spatial candidate in one result set. */
    readonly columns: readonly { ordinal: number; name: string; sqlType?: string }[];
}

export interface QueryStudioResultTabClassification {
    readonly dataResultSets: readonly QsResultSetSummary[];
    readonly planResultSets: readonly QsResultSetSummary[];
    readonly vectorColumns: readonly QueryStudioVectorColumnCandidate[];
    readonly spatialColumns: readonly QueryStudioSpatialColumnCandidate[];
    readonly stringColumnsByResult: Readonly<
        Record<string, readonly { ordinal: number; name: string }[]>
    >;
    /** Remount key for grid engines whose column model is immutable after construction. */
    readonly gridKeysByResult: Readonly<Record<string, string>>;
    readonly totalColumns: number;
}

const STRING_TYPES = new Set(["varchar", "nvarchar", "char", "nchar", "text", "ntext"]);

function hashSchemaPart(hash: number, value: string | number | undefined): number {
    const text = value === undefined ? "" : String(value);
    let next = hash;
    for (let index = 0; index < text.length; index++) {
        next ^= text.charCodeAt(index);
        next = Math.imul(next, 0x01000193);
    }
    // Field separator prevents concatenation aliases without allocating a
    // joined schema string on wide-result state refreshes.
    next ^= 0xff;
    return Math.imul(next, 0x01000193);
}

/**
 * Classify static result metadata once per host state snapshot. Local shell
 * renders (row notifications, cursor moves, resize, tab state) must not rescan
 * every result column or duplicate per-result column descriptors.
 */
export function classifyQueryStudioResultTabs(
    resultSets: readonly QsResultSetSummary[],
): QueryStudioResultTabClassification {
    const dataResultSets: QsResultSetSummary[] = [];
    const planResultSets: QsResultSetSummary[] = [];
    const vectorColumns: QueryStudioVectorColumnCandidate[] = [];
    const spatialColumns: QueryStudioSpatialColumnCandidate[] = [];
    const stringColumnsByResult: Record<string, { ordinal: number; name: string }[]> = {};
    const gridKeysByResult: Record<string, string> = {};
    let totalColumns = 0;

    for (const summary of resultSets) {
        totalColumns += summary.columns?.length ?? summary.columnNames.length;
        if (summary.isPlanResult === true) {
            planResultSets.push(summary);
            continue;
        }
        dataResultSets.push(summary);

        const columns = summary.columns ?? [];
        let schemaHash = 0x811c9dc5;
        const resultStrings: { ordinal: number; name: string }[] = [];
        const resultSpatial: Array<{
            ordinal: number;
            name: string;
            kind: "geometry" | "geography";
        }> = [];
        for (let ordinal = 0; ordinal < columns.length; ordinal++) {
            const column = columns[ordinal];
            const name = column.displayName || column.name;
            schemaHash = hashSchemaPart(schemaHash, column.name);
            schemaHash = hashSchemaPart(schemaHash, column.displayName);
            schemaHash = hashSchemaPart(schemaHash, column.sqlType);
            schemaHash = hashSchemaPart(schemaHash, column.vector?.dimensions);
            schemaHash = hashSchemaPart(schemaHash, column.vector?.transport);
            schemaHash = hashSchemaPart(schemaHash, column.spatial?.kind);
            if (column.vector) {
                vectorColumns.push({
                    resultSetId: summary.resultSetId,
                    columnOrdinal: ordinal,
                    columnName: name,
                    ...(column.vector.dimensions !== undefined
                        ? { dimensions: column.vector.dimensions }
                        : {}),
                    transport: column.vector.transport,
                });
            }
            if (column.spatial) {
                resultSpatial.push({ ordinal, name, kind: column.spatial.kind });
            }
            if (STRING_TYPES.has(column.sqlType?.toLowerCase() ?? "")) {
                resultStrings.push({ ordinal, name });
            }
        }
        if (columns.length === 0) {
            for (const name of summary.columnNames) {
                schemaHash = hashSchemaPart(schemaHash, name);
            }
        }
        gridKeysByResult[summary.resultSetId] =
            `${summary.resultSetId}:${columns.length || summary.columnNames.length}:` +
            (schemaHash >>> 0).toString(36);
        if (resultStrings.length > 0) {
            stringColumnsByResult[summary.resultSetId] = resultStrings;
        }
        if (resultSpatial.length > 0) {
            // Build this once per result set and share it across candidates.
            const displayColumns = columns.map((column, ordinal) => ({
                ordinal,
                name: column.displayName || column.name,
                ...(column.sqlType ? { sqlType: column.sqlType } : {}),
            }));
            const resultSetLabel = `Result ${dataResultSets.length}`;
            for (const spatial of resultSpatial) {
                spatialColumns.push({
                    resultSetId: summary.resultSetId,
                    resultSetLabel,
                    columnOrdinal: spatial.ordinal,
                    columnName: spatial.name,
                    kind: spatial.kind,
                    summaryRowCount: summary.rowCount,
                    columns: displayColumns,
                });
            }
        }
    }

    return {
        dataResultSets,
        planResultSets,
        vectorColumns,
        spatialColumns,
        stringColumnsByResult,
        gridKeysByResult,
        totalColumns,
    };
}
