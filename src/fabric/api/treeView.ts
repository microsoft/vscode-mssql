/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IArtifact } from "./FabricApiClient";
import {
    ArtifactDesignerActions,
    IFabricTreeNodeProvider,
    ILocalProjectTreeNodeProvider,
} from "./satelliteFabricExtension";
import * as path from "path";

/**
 * Base class for all of the Fabric workspace tree items
 */
export abstract class FabricTreeNode extends vscode.TreeItem {
    constructor(
        protected context: vscode.ExtensionContext,
        label: string | vscode.TreeItemLabel,
        collapseState: vscode.TreeItemCollapsibleState,
    ) {
        super(label, collapseState);
    }

    /**
     * Implement this to return the children for the current node. No children are returned by default
     * @returns The child nodes of this node
     */
    public async getChildNodes(): Promise<FabricTreeNode[]> {
        return [];
    }
}

/**
 * The representation of an artifact in the VS Code remote workspaces tree view.
 * Extenders providing child nodes should set the collapse state is set to Collapsed
 */
export class ArtifactTreeNode extends FabricTreeNode {
    /**
     * Creates a new instance of the ArtifactTreeNode class
     * @param artifact - The artifact this node is representing
     * @remarks Sets the following properties of the TreeItem
     *  - label (artifact.displayName)
     *  - contextValue ('Item')
     *  - collapseState (None)
     *  - tooltip (artifact.description)
     * Extenders providing child nodes should set the collapse state is set to Collapsed
     * The node also implements a "Selected" command, which performs the `OperationRequestType.select` action on the artifact
     */
    constructor(
        context: vscode.ExtensionContext,
        public readonly artifact: IArtifact,
    ) {
        super(context, artifact.displayName, vscode.TreeItemCollapsibleState.None);

        this.contextValue = `Item${artifact.type}`; // like 'ItemfunctionSet' or 'ItemNotebook'

        let desc = "";
        if (artifact.description !== null) {
            desc = artifact.description!;
        }
        this.tooltip = new vscode.MarkdownString(desc);

        this.command = {
            // specify a command to execute when selected
            command: "vscode-fabric.readArtifact",
            title: "Read Item",
            arguments: [this],
        };

        const wspaceFolders = vscode.workspace.workspaceFolders;
        const expectedFolderName = `${artifact.displayName}.${artifact.type}`;
        if (
            wspaceFolders && // already a VSCFolder open
            wspaceFolders.find((f) => f.name === expectedFolderName)
        ) {
            this.description = "(currently open)";
            this.contextValue += "currentlyopen";
        } else {
            this.contextValue += "notopen";
        }
    }

    /**
     * The allowed context menu items for this artifact.
     * If not specified, the tree view will contain the ArtifactContextValues.default values.
     * To specify no context menu items, use ArtifactContextValues.none.
     */
    allowedDesignActions?: ArtifactDesignerActions;

    /**
     * Satellite extensions should override this method to create child nodes for the artifact
     * @returns The {@link FabricTreeNode}s to display below this tree node
     */
    async getChildNodes(): Promise<FabricTreeNode[]> {
        return [];
    }
}

/**
 * A default implementation for the IFabricTreeNodeProvider
 */
export class ArtifactTreeNodeProvider implements IFabricTreeNodeProvider {
    /**
     * Creates a new instance of the ArtifactTreeNodeProvider class
     * @param artifactType The type of artifact this class provides
     */
    public constructor(
        private context: vscode.ExtensionContext,
        public artifactType: string,
    ) {}

    /**
     * Creates a tree node for the specified artifact
     * @param artifact - The {@link IArtifact} to create a node for
     * @returns - A default (@link ArtifactTreeNode}
     */
    async createArtifactTreeNode(artifact: IArtifact): Promise<ArtifactTreeNode> {
        return new ArtifactTreeNode(this.context, artifact);
    }
}

/**
 * The representation of a local project in the VS Code local projects tree view.
 * Extenders providing child nodes should set the collapse state is set to Collapsed
 */
export class LocalProjectTreeNode extends FabricTreeNode {
    /**
     * Creates a new instance of the LocalProjectTreeNode class
     * @param displayName - The name to give the node
     * @param path - The path to the local project
     * @remarks Sets the following properties of the TreeItem
     *  - label (displayName)
     *  - collapseState (None)
     *  - tooltip (path)
     * Extenders providing child nodes should set the collapse state is set to Collapsed
     */
    constructor(
        context: vscode.ExtensionContext,
        public displayName: string,
        public folder: vscode.Uri,
    ) {
        super(context, displayName, vscode.TreeItemCollapsibleState.None);
        this.tooltip = folder.fsPath;
    }

    /**
     * Satellite extensions should override this method to create child nodes for the local project
     * @returns The {@link FabricTreeNode}s to display below this tree node
     */
    async getChildNodes(): Promise<FabricTreeNode[]> {
        return [];
    }
}

export class LocalProjectTreeNodeProvider implements ILocalProjectTreeNodeProvider {
    /**
     * Creates a new instance of the LocalProjectTreeNodeProvider class
     * @param artifactType The type of artifact this class provides
     */
    public constructor(
        private context: vscode.ExtensionContext,
        public artifactType: string,
    ) {}

    /**
     * Creates a default tree node for the specified path. Creates the display name of the LocalProjectTreeNode based on the folder name
     * @param localPath - The candidate path for a local project corresponding to the artifact type of this provider
     * @returns - A customized (@link LocalProjectTreeNode}. Returns undefined if the path is not a valid local project
     */
    async createLocalProjectTreeNode(
        localPath: vscode.Uri,
    ): Promise<LocalProjectTreeNode | undefined> {
        let displayName = localPath.fsPath;

        // Expected folder is '<path>\<item_name>.<item_type>'
        // Because of the '.', path.parse will assume the folder is actually a file name with an extension. Use that information in deducing the label
        const parsedPath = path.parse(localPath.path);
        if (parsedPath.ext.toLowerCase() === `.${this.artifactType.toLowerCase()}`) {
            displayName = parsedPath.name;
        }

        return new LocalProjectTreeNode(this.context, displayName, localPath);
    }
}
