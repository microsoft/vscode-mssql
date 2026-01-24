/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ChangeAction,
    ChangeCategory,
    type SchemaChangesSummary,
} from "./diffUtils";

export function getNewTableIds(summary: SchemaChangesSummary | undefined): Set<string> {
    if (!summary) {
        return new Set();
    }

    return new Set(
        summary.groups.filter((group) => group.isNew).map((group) => group.tableId),
    );
}

export function getNewColumnIds(summary: SchemaChangesSummary | undefined): Set<string> {
    if (!summary) {
        return new Set();
    }

    const addedColumns = new Set<string>();
    for (const group of summary.groups) {
        if (group.isNew) {
            continue;
        }
        for (const change of group.changes) {
            if (
                change.category === ChangeCategory.Column &&
                change.action === ChangeAction.Add &&
                change.objectId
            ) {
                addedColumns.add(change.objectId);
            }
        }
    }
    return addedColumns;
}

export function getNewForeignKeyIds(summary: SchemaChangesSummary | undefined): Set<string> {
    if (!summary) {
        return new Set();
    }

    const addedForeignKeys = new Set<string>();
    for (const group of summary.groups) {
        if (group.isNew) {
            continue;
        }
        for (const change of group.changes) {
            if (
                change.category === ChangeCategory.ForeignKey &&
                change.action === ChangeAction.Add &&
                change.objectId
            ) {
                addedForeignKeys.add(change.objectId);
            }
        }
    }
    return addedForeignKeys;
}
