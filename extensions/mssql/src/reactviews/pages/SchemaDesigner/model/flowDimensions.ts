/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

export const NODE_WIDTH = 300;
export const NODE_MARGIN = 50;
export const BASE_NODE_HEIGHT = 70;
export const COLUMN_HEIGHT = 30;

export const FLOW_SPACING = 50;

export function getTableWidth(): number {
    return NODE_WIDTH + NODE_MARGIN;
}

export function getTableHeight(table: SchemaDesigner.Table): number {
    return BASE_NODE_HEIGHT + table.columns.length * COLUMN_HEIGHT;
}
