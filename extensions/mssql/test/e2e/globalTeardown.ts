/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { removeClipboardLockFile } from "./utils/testHelpers";

/**
 * Runs once after every worker has exited, so this run's lock file has no owner left to disturb.
 * Purely tidiness: the path is unique per run, so a file left here blocks nothing.
 */
export default async function globalTeardown(): Promise<void> {
    await removeClipboardLockFile();
}
