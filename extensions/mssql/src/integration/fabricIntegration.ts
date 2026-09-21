/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FabricEnvironment, parseFabricEnvironment } from "../fabric/fabricDatabaseHub";
import { SqlArtifactTypes } from "../sharedInterfaces/fabric";

/**
 * Artifact metadata exposed by @microsoft/vscode-fabric-api.
 *
 * Declared locally because that package is private to the Fabric extension and is not available as
 * a runtime dependency of this extension.
 */
export interface FabricWorkspaceArtifact {
    readonly id: string;
    readonly type: string;
    readonly displayName: string;
    readonly description: string | undefined;
    readonly workspaceId: string;
    readonly fabricEnvironment: string;
}

/**
 * Item node from the Fabric extension's workspace tree.
 *
 * This mirrors ArtifactTreeNode from @microsoft/vscode-fabric-api.
 */
export interface FabricWorkspaceItemNode {
    readonly artifact: FabricWorkspaceArtifact;
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
