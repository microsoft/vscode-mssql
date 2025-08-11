/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Uri } from "vscode";
import { IArtifact, IApiClientRequestOptions, IApiClientResponse } from "./FabricApiClient";
import { OperationRequestType, IOpenArtifactOptions, FunctionalityStatus } from "./fabricExtension";
import { ArtifactTreeNode, LocalProjectTreeNode } from "./treeView";

/**
 * Encapsulates the functionality provided by a satellite extension
 */
export interface IFabricExtension {
    /**
     * The identity of this satellite extension
     */
    identity: string;

    /**
     * The version of the Fabric API this extension is compatible with. Should be passed as '<major>.<minor>'
     */
    apiVersion: string;

    /**
     * The collection of artifact types for which this extension provides custom functionality
     */
    artifactTypes: string[];

    /**
     * The collection of {@link IArtifactHandler}s provided by this extension
     */
    artifactHandlers?: IArtifactHandler[];

    /**
     * The collection of {@link IFabricTreeNodeProvider}s provided by this extension
     */
    treeNodeProviders?: IFabricTreeNodeProvider[];

    /**
     * The collection of {@link ILocalProjectTreeNodeProvider}s provided by this extension
     */
    localProjectTreeNodeProviders?: ILocalProjectTreeNodeProvider[];
}

/**
 * Allows the satellite extension to perform specific actions on an artifact
 */
export interface IArtifactHandler {
    /**
     * The type of artifact this handler provides functionality for
     */
    artifactType: string;

    /**
     * Allows the artifact handler to customize the request prior to it being sent to the Fabric endpoint
     *
     * @deprecated - Use appropriate workflows instead
     *
     * @param action - Indicate what kind of {@link OperationRequestType} is about to be made
     * @param artifact - The {@link IArtifact} that will be operated upon
     * @param request - The {@link IApiClientRequestOptions} that will be sent
     */
    onBeforeRequest?(
        action: OperationRequestType,
        artifact: IArtifact,
        request: IApiClientRequestOptions,
    ): Promise<void>;

    /**
     * Allows the artifact handler to enhance the response after it has been received from the Fabric endpoint
     *
     * @deprecated - Use appropriate workflows instead
     *
     * @param action - Indicate what kind of {@link OperationRequestType} was made
     * @param artifact - The {@link IArtifact} that was operated upon
     * @param request - The {@link IApiClientResponse} returned by the API
     */
    onAfterRequest?(
        action: OperationRequestType,
        artifact: IArtifact,
        response: IApiClientResponse,
    ): Promise<void>;

    /**
     * Allows the artifact handler to open a specific artifact from Fabric
     *
     * @param artifact - The {@link IArtifact} to be opened
     * @param openOptions - Additional options for opening an artifact
     * @returns - A boolean indicating whether the artifact was opened successfully
     */
    onOpen?(artifact: IArtifact, openOptions?: IOpenArtifactOptions): Promise<boolean>;

    /**
     * Provides the creation experience for this artifact type.
     */
    createWorkflow?: ICreateArtifactWorkflow;

    /**
     * Provides the read experience for this artifact type.
     */
    readWorkflow?: IReadArtifactWorkflow;
}

/**
 * Combines the UI and pre-request customization for artifact creation.
 * This interface allows a handler to provide both a UI for gathering additional creation info
 * and to customize the artifact and request before sending to the Fabric endpoint.
 */
export interface ICreateArtifactWorkflow {
    /**
     * Shows UI to gather additional information if this is the item type being created.
     * Returns metadata or undefined if creation is cancelled.
     */
    showCreate(artifact: IArtifact): Promise<any | undefined>;

    /**
     * Allows customization of the artifact before the request is sent.
     * Returns a possibly modified artifact or undefined to cancel
     *
     * @param artifact - The artifact to create
     * @param customItemMetadata - The metadata returned from the UI
     * @param request - The request options
     * @returns - A possibly modified artifact or undefined to cancel
     */
    onBeforeCreate?(
        artifact: IArtifact,
        customItemMetadata: any | undefined,
        request: IApiClientRequestOptions,
    ): Promise<IArtifact | undefined>;

    /**
     * Allows customization of the response after the request is completed.
     * This can be used to handle any post-creation logic or cleanup
     *
     * @param artifact - The artifact that was created
     * @param customItemMetadata - The metadata returned from the UI
     * @param response - The response from the API
     */
    onAfterCreate?(
        artifact: IArtifact,
        customItemMetadata: any | undefined,
        response: IApiClientResponse,
    ): Promise<void>;
}

/**
 * This interface allows a handler to provide pre-request customization for reading an artifact.
 */
export interface IReadArtifactWorkflow {
    /**
     * Allows customization of the API request before it is sent
     * @param artifact The artifact to read
     * @param options The request options
     */
    onBeforeRead?(
        artifact: IArtifact,
        options: IApiClientRequestOptions,
    ): Promise<IApiClientRequestOptions>;
}

/**
 * Flags describing which actions are allowed againt the artifact type.
 */
export enum ArtifactDesignerActions {
    none = 0,
    delete = 1 << 0,
    rename = 1 << 1,
    viewInPortal = 1 << 2,
    default = ~(~0 << 3),
    open = 1 << 3,
    publish = 1 << 4,
    definition = 1 << 5,
}

/**
 * Allows the satellite extension to define item-specific nodes to show in the remote workspace tree view.
 * If a satellite extension does not supply a provider, a default node will be created instead; see {@link ArtifactTreeNode}.
 */
export interface IFabricTreeNodeProvider {
    /**
     * The type of artifact this provider can create nodes for
     */
    artifactType: string;

    /**
     * Creates a tree node for the specified artifact
     * @param artifact - The {@link IArtifact} to create a node for
     * @returns - A customized (@link ArtifactTreeNode}
     */
    createArtifactTreeNode(artifact: IArtifact): Promise<ArtifactTreeNode>;
}

/**
 * Allows the satellite extension to define item-specific nodes to show in the local project tree view.
 */
export interface ILocalProjectTreeNodeProvider {
    /**
     * The type of artifact this provider can create nodes for
     */
    artifactType: string;

    /**
     * Creates a tree node for the specified path
     * @param path - The candidate path for a local project corresponding to the artifact type of this provider
     * @returns - A customized (@link LocalProjectTreeNode}. Returns undefined if the path is not a valid local project
     */
    createLocalProjectTreeNode(path: Uri): Promise<LocalProjectTreeNode | undefined>;
}
