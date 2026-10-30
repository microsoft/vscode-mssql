/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MultiResultsDropTarget, MultiResultsGroup } from "../sharedInterfaces/multiResults";

/**
 * Tracks how results are grouped in the multi-results view. Every result belongs to exactly one
 * group, and one group at a time is shown.
 */
export class MultiResultsLayout {
    private _groups: MultiResultsGroup[] = [];
    private _activeGroupId: string | undefined;
    private _nextGroupId = 1;

    public get groups(): readonly MultiResultsGroup[] {
        return this._groups;
    }

    public get activeGroupId(): string | undefined {
        return this._activeGroupId;
    }

    public get activeGroup(): MultiResultsGroup | undefined {
        return this._groups.find((group) => group.id === this._activeGroupId);
    }

    public get uris(): string[] {
        return this._groups.flatMap((group) => group.uris);
    }

    public has(uri: string): boolean {
        return this.getGroup(uri) !== undefined;
    }

    public getGroup(uri: string): MultiResultsGroup | undefined {
        return this._groups.find((group) => group.uris.includes(uri));
    }

    /**
     * Adds a result as a group of its own at the end of the list. The first result added becomes
     * the active group.
     */
    public add(uri: string): void {
        if (this.has(uri)) {
            return;
        }
        const group = this.createGroup(uri);
        this._groups.push(group);
        this._activeGroupId ??= group.id;
    }

    /**
     * Removes a result. A group left empty is removed, and if it was active the group that took
     * its place in the list becomes active.
     */
    public remove(uri: string): void {
        const group = this.getGroup(uri);
        if (!group) {
            return;
        }
        this.removeFromGroup(group, uri);
    }

    /**
     * Shows the group that holds the result and gives the result focus within it.
     * @returns whether the active group or its focused result changed.
     */
    public focus(uri: string): boolean {
        const group = this.getGroup(uri);
        if (!group || (group.id === this._activeGroupId && group.focusedUri === uri)) {
            return false;
        }
        group.focusedUri = uri;
        this._activeGroupId = group.id;
        return true;
    }

    /**
     * Moves a result into another group, or into a new group of its own, and shows it there.
     */
    public move(uri: string, target: MultiResultsDropTarget): void {
        const source = this.getGroup(uri);
        if (!source) {
            return;
        }

        if (target.kind === "joinGroup") {
            const destination = this._groups.find((group) => group.id === target.groupId);
            if (!destination) {
                return;
            }
            let index = target.index;
            if (destination === source) {
                const from = source.uris.indexOf(uri);
                if (from < index) {
                    index--;
                }
                source.uris.splice(from, 1);
            } else {
                this.removeFromGroup(source, uri);
            }
            destination.uris.splice(clamp(index, 0, destination.uris.length), 0, uri);
            destination.sizes = undefined;
            destination.focusedUri = uri;
            this._activeGroupId = destination.id;
            return;
        }

        let index = clamp(target.index, 0, this._groups.length);
        if (source.uris.length === 1) {
            // Already on its own, so only its place in the list changes.
            const from = this._groups.indexOf(source);
            if (from < index) {
                index--;
            }
            this._groups.splice(from, 1);
            this._groups.splice(index, 0, source);
            this._activeGroupId = source.id;
            return;
        }

        this.removeFromGroup(source, uri);
        const group = this.createGroup(uri);
        this._groups.splice(index, 0, group);
        this._activeGroupId = group.id;
    }

    /**
     * Keeps the pane sizes the user chose for a group. Sizes that do not match the group's
     * results are ignored.
     */
    public setSizes(groupId: string, sizes: number[]): void {
        const group = this._groups.find((g) => g.id === groupId);
        if (group && sizes.length === group.uris.length) {
            group.sizes = [...sizes];
        }
    }

    /**
     * Renames a result in place. A result already listed under the new name, such as the kept
     * result of a closed file that a query is saved over, is removed.
     */
    public rename(oldUri: string, newUri: string): void {
        const group = this.getGroup(oldUri);
        if (!group || oldUri === newUri) {
            return;
        }
        this.remove(newUri);
        group.uris = group.uris.map((uri) => (uri === oldUri ? newUri : uri));
        if (group.focusedUri === oldUri) {
            group.focusedUri = newUri;
        }
    }

    private createGroup(uri: string): MultiResultsGroup {
        return { id: `group-${this._nextGroupId++}`, uris: [uri], focusedUri: uri };
    }

    private removeFromGroup(group: MultiResultsGroup, uri: string): void {
        const index = group.uris.indexOf(uri);
        group.uris.splice(index, 1);
        if (group.uris.length > 0) {
            group.sizes = undefined;
            if (group.focusedUri === uri) {
                group.focusedUri = group.uris[Math.min(index, group.uris.length - 1)];
            }
            return;
        }

        const groupIndex = this._groups.indexOf(group);
        this._groups.splice(groupIndex, 1);
        if (this._activeGroupId === group.id) {
            this._activeGroupId = this._groups[Math.min(groupIndex, this._groups.length - 1)]?.id;
        }
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
