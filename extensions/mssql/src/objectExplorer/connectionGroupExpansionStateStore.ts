/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { DefaultGroupExpansion } from "../constants/constants";

export const connectionGroupExpansionStateStorageKey =
    "objectExplorer.connectionGroupExpansionState";

/** Map of connection group ID to whether that group was last expanded. */
type ConnectionGroupExpansionState = Record<string, boolean>;

/**
 * Persists the expanded/collapsed state of Object Explorer connection groups across sessions,
 * keyed by connection group ID. State is kept in extension storage (e.g. `globalState`) rather
 * than in user-facing settings.
 */
export class ConnectionGroupExpansionStateStore {
    constructor(private readonly _storage: vscode.Memento) {}

    /**
     * Gets the last recorded expansion state for a connection group.
     * @returns `true` if expanded, `false` if collapsed, or `undefined` if no state has been recorded.
     */
    public isExpanded(groupId: string): boolean | undefined {
        return this.readState()[groupId];
    }

    /**
     * Records whether a connection group is expanded.
     */
    public async setExpanded(groupId: string, isExpanded: boolean): Promise<void> {
        const state = this.readState();
        if (state[groupId] === isExpanded) {
            return;
        }

        await this._storage.update(connectionGroupExpansionStateStorageKey, {
            ...state,
            [groupId]: isExpanded,
        });
    }

    /**
     * Removes any recorded expansion state for the given connection groups.
     */
    public async remove(groupIds: string[]): Promise<void> {
        const state = { ...this.readState() };
        let changed = false;

        for (const groupId of groupIds) {
            if (groupId in state) {
                delete state[groupId];
                changed = true;
            }
        }

        if (changed) {
            await this._storage.update(connectionGroupExpansionStateStorageKey, state);
        }
    }

    /**
     * Records connection group expand/collapse events from a tree view.
     * @param treeView The tree view to track
     * @param getGroupId Returns the connection group ID for a tree element, or `undefined` if the
     * element is not a connection group
     * @returns A disposable that stops tracking the tree view.
     */
    public trackTreeView<T>(
        treeView: vscode.TreeView<T>,
        getGroupId: (element: T) => string | undefined,
    ): vscode.Disposable {
        const recordState = (element: T, isExpanded: boolean): void => {
            const groupId = getGroupId(element);
            if (groupId) {
                void this.setExpanded(groupId, isExpanded);
            }
        };

        return vscode.Disposable.from(
            treeView.onDidExpandElement((e) => recordState(e.element, true)),
            treeView.onDidCollapseElement((e) => recordState(e.element, false)),
        );
    }

    private readState(): ConnectionGroupExpansionState {
        return (
            this._storage.get<ConnectionGroupExpansionState>(
                connectionGroupExpansionStateStorageKey,
            ) ?? {}
        );
    }
}

/**
 * Determines whether a connection group should start expanded or collapsed.
 * @param groupId ID of the connection group
 * @param defaultGroupExpansion The configured default group expansion behavior
 * @param store Saved expansion state, consulted when the behavior is `preserved`
 */
export function getInitialGroupCollapsibleState(
    groupId: string,
    defaultGroupExpansion: DefaultGroupExpansion | undefined,
    store: ConnectionGroupExpansionStateStore | undefined,
): vscode.TreeItemCollapsibleState {
    switch (defaultGroupExpansion) {
        case DefaultGroupExpansion.Collapsed:
            return vscode.TreeItemCollapsibleState.Collapsed;
        case DefaultGroupExpansion.Expanded:
            return vscode.TreeItemCollapsibleState.Expanded;
        default:
            return store?.isExpanded(groupId) === false
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.Expanded;
    }
}
