/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    IArtifact,
    IApiClientResponse,
    IFabricApiClient,
    IItemDefinition,
} from "./FabricApiClient";
import { IFabricExtension } from "./satelliteFabricExtension";
import { ArtifactTreeNode, FabricTreeNode } from "./treeView";

/**
 * The kind of operation that can be requested of an artifact. See {@link IArtifactManager}
 *
 * @deprecated - Use artifact workflows instead
 */
export enum OperationRequestType {
    none = 0,
    create = 1 << 0,
    select = 1 << 1,
    update = 1 << 2,
    delete = 1 << 3,
    all = ~(~0 << 4),
}

/**
 * Describes how functional a feature is. The value `none` implies the feature is fully functional
 */
export enum FunctionalityStatus {
    none = 0,
    preview = 1,
    comingSoon = 2,
}

export namespace Schema {
    export const fabric = "fabric"; // make our own private scheme, like "fabric:/"
    export const fabricVirtualDoc = "fabric-virtual-doc";
}

export interface IOpenArtifactOptions {
    folder: vscode.Uri;
}

/**
 * A set of services implemented by the core Fabric extension to be consumed by satellite extensions
 *
 * @example
 *
 * ``` ts
 * import * as fabricExt from '@fabric/vscode-fabric-api';
 *
 * export function activate(context: vscode.ExtensionContext) {
 *   const fabricExtensionServices: fabricExt.IFabricExtensionServiceCollection = <fabricExt.IFabricExtensionServiceCollection>vscode.extensions.getExtension('fabric.vscode-fabric')!.exports;
 */
export interface IFabricExtensionServiceCollection {
    artifactManager: IArtifactManager;
    workspaceManager: IWorkspaceManager;
    apiClient: IFabricApiClient;
}

/**
 * Provides a way to manage artifacts with the Fabric back end
 */
export interface IArtifactManager {
    /**
     * Creates the specified artifact on the Fabric back end
     *
     * @param artifact - The artifact to create
     */
    createArtifact(artifact: IArtifact, itemSpecificMetadata?: any): Promise<IApiClientResponse>;

    /**
     * Creates an item in the specified workspace using the specified definition
     *
     * @param artifact - The artifact to create
     * @param definition - The item definition to use for creating the artifact
     */
    createArtifactWithDefinition(
        artifact: IArtifact,
        definition: IItemDefinition,
    ): Promise<IApiClientResponse>;

    /**
     * Gets the specified artifact on the Fabric back end
     *
     * @param artifact - The artifact to get
     */
    getArtifact(artifact: IArtifact): Promise<IApiClientResponse>;

    /**
     * Returns a list of items from the specified workspace
     *
     * @param workspace - The workspace to list artifacts for
     * @returns A list of artifacts in the specified workspace
     * @throws FabricError if the request fails
     */
    listArtifacts(workspace: IWorkspace): Promise<IArtifact[]>;

    /**
     * Updates the specified artifact from the Fabric back end
     *
     * @param artifact - The artifact to update
     */
    updateArtifact(artifact: IArtifact, body: Map<string, string>): Promise<IApiClientResponse>;

    /**
     * Deletes the specified artifact from the Fabric back end
     *
     * @param artifact - The artifact to delete
     */
    deleteArtifact(artifact: IArtifact): Promise<IApiClientResponse>;

    /**
     * Gets the definition for the specified artifact from the Fabric back end
     */
    getArtifactDefinition(artifact: IArtifact): Promise<IApiClientResponse>;

    /**
     * Updates the definition for the specified artifact on the Fabric back end
     */
    updateArtifactDefinition(
        artifact: IArtifact,
        definition: IItemDefinition,
    ): Promise<IApiClientResponse>;

    /**
     * Gets the specified artifact from the Fabric back end
     *
     * @deprecated - use IReadArtifactWorkflow instead
     * @param artifact - The artifact to fetch
     */
    selectArtifact(artifact: IArtifact): Promise<IApiClientResponse>;

    /**
     * Opens the artifact with the specified options
     *
     * @deprecated - use getArtifactDefinition instead
     * @param artifact - The artifact to open
     * @remarks  The request is fully handled by the {@link IArtifactHandler}
     */
    openArtifact(artifact: IArtifact): Promise<void>;

    getArtifactData(artifact: IArtifact): Promise<IApiClientResponse>;
    getArtifactPayload(artifact: IArtifact): Promise<any>;

    /**
     * Execute context menu items one at a time: disallow other context menu items until prior one completed.
     *
     * @deprecated - This will be removed in a future release
     * @param cmdArgs the command arguments if any
     * @param callback  the code to call when cmd invoked, passing in the ArtifactTreeNode as a parameter
     */
    doContextMenuItem(
        cmdArgs: any[],
        description: string,
        callback: (item: ArtifactTreeNode | undefined) => Promise<void>,
    ): Promise<boolean>;
}

/**
 * The filesystem provides a way for extensions to write files in consistent manner for all Fabric extensions.
 *
 * @remarks The filesystem  works with {@link Uri uris} and assumes hierarchical
 * paths, e.g. `foo:/my/path` is a child of `foo:/my/` and a parent of `foo:/my/path/deeper`.
 */
export interface ILocalFileSystem {
    /**
     * Creates a Fabric-specific Uri for the specified file path
     *
     * @param filePath - The full path for the filesystem entity to be created
     */
    createUri(filePath: string): vscode.Uri;

    /**
     * Write data to a file, replacing its entire contents.
     *
     * @param uri The uri of the file.
     * @param content The new content of the file.
     * @param options Defines if missing files should or must be created.
     */
    writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        options: { create: boolean; overwrite: boolean },
    ): void | Thenable<void>;
}

/**
 * Provides a way to notify the core Fabric extension of the presence of a satellite extension
 */
export interface IFabricExtensionManager {
    addExtension(extension: IFabricExtension): IFabricExtensionServiceCollection;

    getFunctionToFetchCommonTelemetryProperties(): () => { [key: string]: string };

    /**
     * Optional testHooks that are only set in test environments
     */
    testHooks?: { [key: string]: any };
}

/**
 * IWorkspace Fabric workspace as seen in api responses
 */
export interface IWorkspace {
    objectId: string;
    capacityId?: string; // supplied when getting a single workspace, but only sometimes when getting all workspaces (perhaps newer workspaces?)
    type: string;
    displayName: string;
    description: string;
    sourceControlInformation?: ISourceControlInformation;
}

/**
 * Performs IDE-specific functions for Fabric workspaces
 */
export interface IWorkspaceManager {
    listWorkspaces(): Promise<IWorkspace[]>;
    createWorkspace(
        workspaceName: string,
        options?: { capacityId?: string; description?: string },
    ): Promise<IApiClientResponse>;
    get currentWorkspace(): IWorkspace | undefined;
    getLocalFolderForCurrentFabricWorkspace(
        options?: { createIfNotExists?: boolean } | undefined,
    ): Promise<vscode.Uri | undefined>;
    getLocalFolderForArtifact(
        artifact: IArtifact,
        options?: { createIfNotExists?: boolean } | undefined,
    ): Promise<vscode.Uri | undefined>;
    get onDidChangePropertyValue(): vscode.Event<string>;
    getItemsInWorkspace(): Promise<IArtifact[]>;
    isProcessingAutoLogin: boolean;
    fabricWorkspaceContext: string;
    isConnected(): Promise<boolean>;
    treeView: vscode.TreeView<FabricTreeNode> | undefined;
    clearPriorStateIfAny(): void;
    openWorkspaceById(id: string): Promise<void>;
}

/**
 * Git connection details for a workspace
 */
export interface ISourceControlInformation {
    /**
     * The name of the branch to clone; if not specified, the default branch will be cloned
     */
    branchName?: string;

    /**
     * The URL of the git repository
     */
    repository?: string;

    /**
     * The relative path to the workspace root within the repository
     */
    directoryName?: string;
}
