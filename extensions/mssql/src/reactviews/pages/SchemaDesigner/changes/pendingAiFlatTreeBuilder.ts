/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangeAction, ChangeCategory, SchemaChange } from "../diff/diffUtils";
import type { FlatTreeItem } from "./schemaDesignerChangesTree";
import type { PendingAiItem } from "../aiLedger/operations";

interface PendingAiChangeEntry {
    item: PendingAiItem;
    change: SchemaChange;
}

/**
 * Builds the flat tree item list used by the pending AI changes panel.
 *
 * Groups changes by table, detects add/delete/rename actions,
 * and produces the nested tree structure consumed by `FlatTree`.
 */
export function buildPendingAiFlatTreeItems(
    entries: PendingAiChangeEntry[],
    getChangeDescription: (change: SchemaChange) => string,
): FlatTreeItem[] {
    const items: FlatTreeItem[] = [];
    const groups = new Map<
        string,
        {
            tableId: string;
            tableName: string;
            tableSchema: string;
            isNew: boolean;
            isDeleted: boolean;
            changes: SchemaChange[];
            orderedChanges: SchemaChange[];
            renameParentId?: string;
        }
    >();

    for (const { change } of entries) {
        const existing = groups.get(change.tableId);
        if (existing) {
            existing.changes.push(change);
            existing.orderedChanges.push(change);
            continue;
        }

        groups.set(change.tableId, {
            tableId: change.tableId,
            tableName: change.tableName,
            tableSchema: change.tableSchema,
            isNew: false,
            isDeleted: false,
            changes: [change],
            orderedChanges: [change],
        });
    }

    for (const group of groups.values()) {
        group.isNew = group.changes.some(
            (change) =>
                change.category === ChangeCategory.Table && change.action === ChangeAction.Add,
        );
        group.isDeleted = group.changes.some(
            (change) =>
                change.category === ChangeCategory.Table && change.action === ChangeAction.Delete,
        );

        const renameParent = group.changes.find(
            (change) =>
                change.category === ChangeCategory.Table &&
                change.action === ChangeAction.Modify &&
                !!change.propertyChanges?.some(
                    (propertyChange) =>
                        propertyChange.property === "name" || propertyChange.property === "schema",
                ),
        );
        group.renameParentId = renameParent?.id;

        if (renameParent) {
            group.orderedChanges = [
                renameParent,
                ...group.changes.filter((change) => change.id !== renameParent.id),
            ];
        }

        const qualifiedName = `[${group.tableSchema}].[${group.tableName}]`;
        const tableValue = `ai-table-${group.tableId}`;
        items.push({
            value: tableValue,
            nodeType: "table",
            tableGroup: {
                tableId: group.tableId,
                tableName: group.tableName,
                tableSchema: group.tableSchema,
                isNew: group.isNew,
                isDeleted: group.isDeleted,
                changes: group.changes,
            },
            tableId: group.tableId,
            content: qualifiedName,
        });

        for (const change of group.orderedChanges) {
            const isDependentChild = !!group.renameParentId && change.id !== group.renameParentId;
            items.push({
                value: `ai-change-${change.id}`,
                parentValue: tableValue,
                nodeType: "change",
                change,
                tableId: change.tableId,
                content: getChangeDescription(change),
                suppressPendingAiActions: isDependentChild,
            });
        }
    }

    return items;
}
