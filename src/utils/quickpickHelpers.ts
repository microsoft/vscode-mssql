/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

export interface MssqlQuickPickItem extends vscode.QuickPickItem {
    /** Optional group label for the quick pick item */
    group?: string;
}

/**
 * Orders quick pick items by their group, inserting separators where needed.
 * Groups are sorted alphabetically, with the contents within each group left in the same order as `items`.
 * Ungrouped items appear first, and are not assigned a group label.
 */
export function groupQuickPickItems<TQuickPickItem extends MssqlQuickPickItem>(
    items: TQuickPickItem[],
): TQuickPickItem[] {
    const grouped = Map.groupBy<string, TQuickPickItem>(items, (x) => x.group);
    const result: TQuickPickItem[] = [];

    // Ungrouped items first...
    if (grouped.has(undefined)) {
        result.push(...grouped.get(undefined));
    }

    // ...then grouped items
    const definedGroups = Array.from(grouped.keys())
        .filter((group) => group !== undefined)
        .sort();

    for (const group of definedGroups) {
        result.push({
            label: group,
            kind: vscode.QuickPickItemKind.Separator,
        } as TQuickPickItem);
        result.push(...grouped.get(group));
    }

    return result;
}
