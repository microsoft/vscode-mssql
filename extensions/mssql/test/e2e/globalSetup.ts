/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { clearClipboardLockFile } from "./utils/testHelpers";

/**
 * Runs once before any worker starts.
 *
 * The clipboard lock is a file in the temp directory, so a run killed while a worker held it
 * leaves the file behind and would block every clipboard test in the next run. Clearing it here
 * is safe precisely because no worker exists yet; see acquireClipboardLock for why the same
 * cleanup cannot be done from inside a worker.
 */
export default async function globalSetup(): Promise<void> {
    await clearClipboardLockFile();
}
