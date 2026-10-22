/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createClipboardLockPath, setClipboardLockPath } from "./utils/testHelpers";

/**
 * Runs once before any worker starts.
 *
 * Mints this run's clipboard lock path and puts it in the environment, which the workers inherit
 * because they are forked after this. A path per run means the workers of one run share a lock
 * while separate runs never touch each other's, so no code ever has to delete a file it does not
 * own -- see acquireClipboardLock for why that property is what keeps the lock correct.
 */
export default async function globalSetup(): Promise<void> {
    setClipboardLockPath(createClipboardLockPath());
}
