/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FabricEnvironment, parseFabricEnvironment } from "../fabric/fabricDatabaseHub";
import { IArtifact, SqlArtifactTypes } from "../sharedInterfaces/fabric";

/**
 * Item node from the Fabric extension's workspace tree.
 *
 * The Fabric extension exposes the item's {@link IArtifact} on the node, and additionally tags it
 * with the name of the Fabric portal environment its workspace lives in.
 */
export interface FabricWorkspaceItemNode {
    readonly artifact: Pick<IArtifact, "type" | "displayName"> & {
        readonly fabricEnvironment?: string;
    };
}

export function isFabricWorkspaceItemNode(node: unknown): node is FabricWorkspaceItemNode {
    if (typeof node !== "object" || !node || !("artifact" in node)) {
        return false;
    }

    const { artifact } = node;
    return (
        typeof artifact === "object" &&
        !!artifact &&
        "type" in artifact &&
        typeof artifact.type === "string"
    );
}

/** Whether a Fabric workspace tree node represents a Fabric SQL database. */
export function isFabricSqlDatabaseNode(node: FabricWorkspaceItemNode): boolean {
    return node.artifact.type === SqlArtifactTypes.SqlDatabase;
}

/**
 * Resolves the Fabric portal environment a workspace tree node belongs to.
 *
 * @returns undefined when the node reports no environment, or one this extension does not know.
 */
export function getFabricWorkspaceItemEnvironment(
    node: FabricWorkspaceItemNode,
): FabricEnvironment | undefined {
    return parseFabricEnvironment(node.artifact.fabricEnvironment);
}
