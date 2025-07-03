/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { groupBy } from "./utils";

export interface MssqlQuickPickItem extends vscode.QuickPickItem {
    /** Optional group label for the quick pick item */
    group?: string;
}

/** Orders quick pick items by their group, inserting separators where needed */
export function groupQuickPickItems<TQuickPickItem extends MssqlQuickPickItem>(
    items: TQuickPickItem[],
): TQuickPickItem[] {
    const grouped = groupBy<string, TQuickPickItem>(items, "group");
    const result: TQuickPickItem[] = [];

    const sortedGroups = Array.from(grouped.keys()).sort();

    for (const group of sortedGroups) {
        if (group) {
            result.push({
                label: group,
                kind: vscode.QuickPickItemKind.Separator,
            } as TQuickPickItem);
        }
        result.push(...grouped.get(group));
    }

    return result;
}
