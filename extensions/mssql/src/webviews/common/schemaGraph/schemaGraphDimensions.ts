/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Schema graph sizing facts (SV-R3). Values intentionally MATCH the legacy
 * Schema Designer dimensions (visual parity), but the height function is
 * count-based — no dependency on any page DTO.
 */

export const SCHEMA_GRAPH_NODE_WIDTH = 300;
export const SCHEMA_GRAPH_NODE_MARGIN = 50;
export const SCHEMA_GRAPH_BASE_NODE_HEIGHT = 70;
export const SCHEMA_GRAPH_COLUMN_HEIGHT = 30;
export const SCHEMA_GRAPH_SPACING = 50;

export function schemaGraphTableWidth(): number {
    return SCHEMA_GRAPH_NODE_WIDTH + SCHEMA_GRAPH_NODE_MARGIN;
}

/**
 * Layout height for a table node. Uses the FULL column count (legacy
 * parity: collapsed nodes still reserve full layout height, so expanding
 * never forces a re-layout).
 */
export function schemaGraphTableHeight(columnCount: number): number {
    return SCHEMA_GRAPH_BASE_NODE_HEIGHT + columnCount * SCHEMA_GRAPH_COLUMN_HEIGHT;
}
