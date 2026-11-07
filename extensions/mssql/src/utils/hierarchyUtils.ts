/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ParentFirstOrderResult<T> {
    orderedItems: T[];
    unresolvedItems: T[];
}

/**
 * Orders hierarchical items so each parent appears before its children.
 * Items with missing parents or cycles are returned separately.
 */
export function orderItemsParentFirst<T>(
    items: readonly T[],
    getId: (item: T) => string,
    getParentId: (item: T) => string | undefined,
    knownItemIds: ReadonlySet<string> = new Set(),
): ParentFirstOrderResult<T> {
    const availableItemIds = new Set(knownItemIds);
    const unresolvedItems = [...items];
    const orderedItems: T[] = [];

    let orderedItemInPass = true;
    while (unresolvedItems.length > 0 && orderedItemInPass) {
        orderedItemInPass = false;

        for (let index = 0; index < unresolvedItems.length; ) {
            const item = unresolvedItems[index];
            const parentId = getParentId(item);
            if (parentId !== undefined && !availableItemIds.has(parentId)) {
                index++;
                continue;
            }

            unresolvedItems.splice(index, 1);
            orderedItems.push(item);
            availableItemIds.add(getId(item));
            orderedItemInPass = true;
        }
    }

    return { orderedItems, unresolvedItems };
}
