/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import { sanitizeRunFileId } from "../runbookRunLedger";

const MANAGED_ARTIFACT_EXTENSIONS = new Set([".dacpac", ".json", ".patch", ".sql", ".xml", ".xel"]);

/** Build one filesystem-safe managed-artifact filename while retaining the
 * closed semantic extension. DacFx and the native artifact actions use the
 * extension as part of their contract, so it must not pass through the run-id
 * sanitizer that replaces dots with underscores. */
export function localManagedArtifactFileName(nodeId: string, requestedName: string): string {
    const leaf = path.win32.basename(path.posix.basename(requestedName.trim()));
    const extension = path.extname(leaf).toLowerCase();
    if (!MANAGED_ARTIFACT_EXTENSIONS.has(extension)) {
        throw new Error(`unsupported managed artifact extension '${extension || "(none)"}'`);
    }
    const rawStem = leaf.slice(0, -extension.length);
    const node = sanitizeRunFileId(nodeId).slice(0, 64) || "node";
    const stem =
        sanitizeRunFileId(rawStem).slice(0, Math.max(1, 80 - extension.length)) || "artifact";
    return `${node}-${stem}${extension}`;
}
