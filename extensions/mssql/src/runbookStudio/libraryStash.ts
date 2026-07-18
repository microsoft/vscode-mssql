/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Library artifact stash (R3, D-0012): when a runbook publishes to the
 * runtime library, its source artifact JSON is stashed under
 * `<globalStorage>/runbookStudio/library/<assetId>.runbook.json` so
 * open-from-library round-trips the EXACT authored document. Assets
 * published elsewhere have no stash — the library commands say so honestly
 * instead of fabricating an import. Lives in the extension layer on purpose:
 * the runtime adapter must never import vscode.
 */

import * as vscode from "vscode";

const STASH_SEGMENTS = ["runbookStudio", "library"] as const;

/** Filesystem-safe projection of an asset id (deterministic, both ways). */
export function sanitizeAssetId(assetId: string): string {
    return assetId.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** The stash file URI for an asset (existence not implied). */
export function stashUri(globalStorageUri: vscode.Uri, assetId: string): vscode.Uri {
    return vscode.Uri.joinPath(
        globalStorageUri,
        ...STASH_SEGMENTS,
        `${sanitizeAssetId(assetId)}.runbook.json`,
    );
}

/** Write (or overwrite) the stashed artifact JSON; returns the file URI. */
export async function writeStash(
    globalStorageUri: vscode.Uri,
    assetId: string,
    artifactJson: string,
): Promise<vscode.Uri> {
    await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(globalStorageUri, ...STASH_SEGMENTS),
    );
    const target = stashUri(globalStorageUri, assetId);
    await vscode.workspace.fs.writeFile(target, Buffer.from(artifactJson, "utf8"));
    return target;
}

/** Read the stashed artifact JSON; undefined when no stash exists. */
export async function readStash(
    globalStorageUri: vscode.Uri,
    assetId: string,
): Promise<string | undefined> {
    try {
        const bytes = await vscode.workspace.fs.readFile(stashUri(globalStorageUri, assetId));
        return Buffer.from(bytes).toString("utf8");
    } catch {
        return undefined;
    }
}

/** Delete the stashed artifact file; a missing stash is a silent no-op
 *  (delete-runbook must succeed for assets that never had one). */
export async function removeStash(globalStorageUri: vscode.Uri, assetId: string): Promise<void> {
    try {
        await vscode.workspace.fs.delete(stashUri(globalStorageUri, assetId));
    } catch {
        // Already absent — nothing to remove.
    }
}
