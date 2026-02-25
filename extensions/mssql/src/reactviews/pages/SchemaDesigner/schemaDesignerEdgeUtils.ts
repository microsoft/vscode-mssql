/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lightweight helpers for FK edge identity and filtering.
 *
 * NOTE: React Flow edge `id` is not the same as Schema Designer FK `id`.
 * FK id is stored on `edge.data.id`.
 */

export interface ForeignKeyEdgeDataLike {
    id?: string;
    columnsIds?: string[];
    referencedColumnsIds?: string[];
}

export interface ForeignKeyEdgeLike {
    id: string;
    data?: ForeignKeyEdgeDataLike;
    source?: string;
    target?: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
}

export function buildForeignKeyEdgeId(
    sourceTableId: string,
    targetTableId: string,
    sourceColumnId: string,
    targetColumnId: string,
): string {
    return `${sourceTableId}-${targetTableId}-${sourceColumnId}-${targetColumnId}`;
}

/**
 * Updates incoming FK edges (edges where the changed table is the referenced/target table)
 * to reflect renamed referenced columns.
 */
export function applyColumnRenamesToIncomingForeignKeyEdges<T extends ForeignKeyEdgeLike>(
    edges: T[],
    referencedTableId: string,
    renamedColumns: Map<string, string>,
): void {
    if (renamedColumns.size === 0) {
        return;
    }

    for (const edge of edges) {
        // Only incoming edges
        const target = edge.target;

        if (!target || target !== referencedTableId) {
            continue;
        }

        // Update data payload (per-column edge -> referencedColumnsIds is typically a single-element array)
        const data = edge.data;
        if (!data?.referencedColumnsIds || data.referencedColumnsIds.length !== 1) {
            continue;
        }

        const oldReferencedColId = data.referencedColumnsIds[0];
        const newReferencedColId = renamedColumns.get(oldReferencedColId);
        if (!newReferencedColId || newReferencedColId === oldReferencedColId) {
            continue;
        }

        data.referencedColumnsIds = [newReferencedColId];
    }
}

/**
 * Updates outgoing FK edges (edges where the changed table is the source table)
 * to reflect renamed source columns.
 */
export function applyColumnRenamesToOutgoingForeignKeyEdges<T extends ForeignKeyEdgeLike>(
    edges: T[],
    sourceTableId: string,
    renamedColumns: Map<string, string>,
): void {
    if (renamedColumns.size === 0) {
        return;
    }

    for (const edge of edges) {
        const source = edge.source;

        if (!source || source !== sourceTableId) {
            continue;
        }

        // Update data payload (per-column edge -> columnsIds is typically a single-element array)
        const data = edge.data;
        if (!data?.columnsIds || data.columnsIds.length !== 1) {
            continue;
        }

        const oldSourceColId = data.columnsIds[0];
        const newSourceColId = renamedColumns.get(oldSourceColId);
        if (!newSourceColId || newSourceColId === oldSourceColId) {
            continue;
        }

        data.columnsIds = [newSourceColId];
    }
}

export function removeEdgesForForeignKey<T extends ForeignKeyEdgeLike>(
    edges: T[],
    foreignKeyId: string | undefined,
): T[] {
    if (!foreignKeyId) {
        return edges;
    }

    return edges.filter((e) => e.data?.id !== foreignKeyId);
}
