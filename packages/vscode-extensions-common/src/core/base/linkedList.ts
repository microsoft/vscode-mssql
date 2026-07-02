/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class LinkedList<T> implements Iterable<T> {
    private readonly _items: T[] = [];

    push(item: T): () => void {
        this._items.push(item);

        return () => {
            const index = this._items.indexOf(item);
            if (index >= 0) {
                this._items.splice(index, 1);
            }
        };
    }

    [Symbol.iterator](): Iterator<T> {
        return this._items[Symbol.iterator]();
    }
}
