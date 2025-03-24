/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

export const NODEWIDTH = 300;

export const calculateTableWidth = () => {
    return NODEWIDTH + 30;
};
export const calculateTableHeight = (table: SchemaDesigner.Table) => {
    return 70 + table.columns.length * 30;
};
