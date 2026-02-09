/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { ChangeAction, ChangeCategory, PropertyChange } from "../diff/diffUtils";

export type Table = SchemaDesigner.Table;
export type Column = SchemaDesigner.Column;
export type ForeignKey = SchemaDesigner.ForeignKey;
export type LedgerSnapshot = Table | Column | ForeignKey;

export interface AiLedgerOperation {
    id: string;
    category: ChangeCategory;
    action: ChangeAction;
    tableId: string;
    tableSchema: string;
    tableName: string;
    objectId?: string;
    objectName?: string;
    beforeSnapshot: LedgerSnapshot | null;
    afterSnapshot: LedgerSnapshot | null;
}

export interface AiLedgerDiffOperation {
    key: string;
    category: ChangeCategory;
    action: ChangeAction;
    tableId: string;
    tableSchema: string;
    tableName: string;
    objectId?: string;
    objectName?: string;
    baselineTableSchema?: string;
    baselineTableName?: string;
    currentTableSchema?: string;
    currentTableName?: string;
    baselineSnapshot: LedgerSnapshot | null;
    currentSnapshot: LedgerSnapshot | null;
    propertyChanges?: PropertyChange[];
}

export interface PendingAiItem {
    id: string;
    key: string;
    order?: number;
    category: ChangeCategory;
    action: ChangeAction;
    tableId: string;
    tableKey: string;
    tableSchema: string;
    tableName: string;
    objectId?: string;
    objectName?: string;
    title: string;
    friendlyName: string;
    baselineTableSchema?: string;
    baselineTableName?: string;
    currentTableSchema?: string;
    currentTableName?: string;
    baselineSnapshot: LedgerSnapshot | null;
    currentSnapshot: LedgerSnapshot | null;
    propertyChanges?: PropertyChange[];
    appliedOps: AiLedgerOperation[];
}

export interface PendingAiTableGroup {
    key: string;
    tableKey: string;
    tableId: string;
    title: string;
    friendlyName: string;
    originalTableSchema: string;
    originalTableName: string;
    currentTableSchema: string;
    currentTableName: string;
    isDeleted: boolean;
    items: PendingAiItem[];
}

export interface AiLedgerApplyResult {
    operations: AiLedgerOperation[];
    diffOperations: AiLedgerDiffOperation[];
    pendingGroups: PendingAiTableGroup[];
    pendingItems: PendingAiItem[];
}
