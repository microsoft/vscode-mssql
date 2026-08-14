/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class MutationCoordinator {
    private readonly _pendingMutations = new Set<Promise<void>>();

    public track(mutation: Promise<void>): void {
        this._pendingMutations.add(mutation);
        void mutation.then(
            () => this._pendingMutations.delete(mutation),
            () => undefined,
        );
    }

    public async waitForPending(): Promise<void> {
        const pendingMutations = [...this._pendingMutations];
        try {
            await Promise.all(pendingMutations);
        } finally {
            pendingMutations.forEach((mutation) => this._pendingMutations.delete(mutation));
        }
    }
}
