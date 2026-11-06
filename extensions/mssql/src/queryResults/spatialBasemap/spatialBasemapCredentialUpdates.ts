/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Suspend credential-backed source access until old tiles have been purged. */
export class SpatialBasemapCredentialUpdates {
    private pending = 0;
    private staleCache = false;

    constructor(
        private readonly invalidateSessions: () => void,
        private readonly clearCache: () => Promise<void>,
    ) {}

    get active(): boolean {
        return this.pending > 0 || this.staleCache;
    }

    async update(save: () => PromiseLike<void>): Promise<void> {
        this.pending++;
        this.invalidateSessions();
        try {
            await save();
            this.staleCache = true;
            await this.clearCache();
            this.staleCache = false;
        } finally {
            this.pending--;
            this.invalidateSessions();
        }
    }
}
