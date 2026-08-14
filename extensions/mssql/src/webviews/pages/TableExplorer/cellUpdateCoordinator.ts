/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class CellUpdateCoordinator {
    private readonly _pendingUpdates = new Set<Promise<void>>();

    public track(update: Promise<void>): void {
        this._pendingUpdates.add(update);
        void update.then(
            () => this._pendingUpdates.delete(update),
            () => undefined,
        );
    }

    public async commitCurrentEditAndWait(commitCurrentEdit: () => boolean): Promise<boolean> {
        if (!commitCurrentEdit()) {
            return false;
        }

        const pendingUpdates = [...this._pendingUpdates];
        try {
            await Promise.all(pendingUpdates);
            return true;
        } finally {
            pendingUpdates.forEach((update) => this._pendingUpdates.delete(update));
        }
    }
}
