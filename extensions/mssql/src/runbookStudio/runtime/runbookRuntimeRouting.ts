/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    RunbookArtifactFile,
    RunbookCapabilityManifest,
} from "../../sharedInterfaces/runbookStudio";

/** Activity subset that the current artifact-to-Hobbes publisher translates.
 * Report/gate nodes are handled separately by the translator. Keep this
 * closed: an extension-native DacFx/process/filesystem activity must never be
 * sent to Hobbes and then silently represented as prose. */
export const HOBBES_TRANSLATABLE_ACTIVITY_KINDS: ReadonlySet<string> = new Set([
    "sql.query.read",
    "assert.threshold",
]);

export function manifestRequiresExtensionPlanner(
    manifest: RunbookCapabilityManifest | undefined,
): boolean {
    return (
        manifest?.activities.some(
            (activity) => !HOBBES_TRANSLATABLE_ACTIVITY_KINDS.has(activity.kind),
        ) === true
    );
}

/** Select execution authority per locked plan. The user-facing runtime
 * setting still selects Hobbes for runtime-authored/publishable plans; a lock
 * containing extension-native activities routes to the guarded local walker.
 * Fake remains an explicit deterministic preview override. */
export function executionRuntimeKindForArtifact(
    configuredRuntimeKind: string,
    artifact: RunbookArtifactFile,
): string {
    if (configuredRuntimeKind !== "hobbes") {
        return configuredRuntimeKind;
    }
    const hasExtensionActivity =
        artifact.lock?.nodes.some(
            (node) =>
                node.kind === "activity" &&
                !HOBBES_TRANSLATABLE_ACTIVITY_KINDS.has(node.activityKind ?? ""),
        ) === true;
    return hasExtensionActivity ? "local" : "hobbes";
}
