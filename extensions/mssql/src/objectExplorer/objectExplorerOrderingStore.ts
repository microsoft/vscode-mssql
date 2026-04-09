/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

const STATE_KEY = "mssql.objectExplorer.childOrder";

type OrderMap = Record<string, string[]>;

/**
 * Persists drag-and-drop ordering of Object Explorer connections and connection groups.
 *
 * Order is stored sparsely in the extension's global state, keyed by parent group ID
 * (use `ConnectionConfig.ROOT_GROUP_ID` for items at the root). Items not present in
 * the persisted list fall back to the default alphabetical sort applied by the tree.
 *
 * Storing this ordering in global state (rather than user/workspace settings) keeps
 * the user's connection settings file untouched while still letting the order survive
 * across sessions.
 */
export class ObjectExplorerOrderingStore {
    constructor(private readonly _context: vscode.ExtensionContext) {}

    private getMap(): OrderMap {
        return this._context.globalState.get<OrderMap>(STATE_KEY) ?? {};
    }

    private async setMap(map: OrderMap): Promise<void> {
        await this._context.globalState.update(STATE_KEY, map);
    }

    /** Returns the persisted order for the given parent group, or [] if none. */
    public getChildOrder(parentId: string): string[] {
        return this.getMap()[parentId] ?? [];
    }

    /**
     * Inserts `movingId` adjacent to `anchorId` within `parentId`. Both ids are added
     * to the persisted order if not already present, ensuring the relative position is
     * preserved across sessions even when neither sibling had an explicit order before.
     */
    public async insertAdjacent(
        parentId: string,
        movingId: string,
        anchorId: string,
        position: "before" | "after",
    ): Promise<void> {
        if (movingId === anchorId) {
            return;
        }
        const map = this.getMap();
        const order = (map[parentId] ?? []).filter((id) => id !== movingId);
        if (!order.includes(anchorId)) {
            order.push(anchorId);
        }
        let idx = order.indexOf(anchorId);
        if (position === "after") {
            idx += 1;
        }
        order.splice(idx, 0, movingId);
        map[parentId] = order;
        await this.setMap(map);
    }

    /** Removes `movingId` from the persisted order of `parentId`, if present. */
    public async removeFromParent(parentId: string, movingId: string): Promise<void> {
        const map = this.getMap();
        const existing = map[parentId];
        if (!existing || !existing.includes(movingId)) {
            return;
        }
        map[parentId] = existing.filter((id) => id !== movingId);
        await this.setMap(map);
    }
}
