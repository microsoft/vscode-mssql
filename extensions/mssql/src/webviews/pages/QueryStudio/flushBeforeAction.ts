/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Wait for both the in-flight edit group and any edits queued behind it. */
export async function flushBeforeQueryStudioAction(
    flush: () => Promise<boolean>,
    isSynchronized: () => boolean,
): Promise<boolean> {
    // Another panel can keep editing. Never save or execute a known stale
    // document, and never wait indefinitely for it to stop changing.
    for (let attempt = 0; attempt < 32; attempt++) {
        const applied = await flush();
        if (isSynchronized()) return true;
        if (!applied) return false;
    }
    return false;
}
