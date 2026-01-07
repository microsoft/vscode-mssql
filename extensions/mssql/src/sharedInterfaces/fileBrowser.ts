/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-languageclient";

//#region Sql Tools Service Interfaces
export namespace FileBrowserOpenRequest {
    export const type = new RequestType<FileBrowserOpenParams, boolean, void, void>(
        "filebrowser/open",
    );
}

export namespace FileBrowserOpenNotification {
    export const type = new NotificationType<FileBrowserOpenResponse, void>(
        "filebrowser/opencomplete",
    );
}

export interface FileBrowserOpenParams {
    ownerUri: string;
    // Initial path to expand
    expandPath: string;
    fileFilters: string[];
    changeFilter: boolean;
    showFoldersOnly?: boolean;
}

export interface FileBrowserOpenResponse {
    ownerUri: string;
    fileTree: FileTree;
    succeeded: boolean;
    message: string;
}

export namespace FileBrowserExpandRequest {
    export const type = new RequestType<FileBrowserExpandParams, boolean, void, void>(
        "filebrowser/expand",
    );
}

export namespace FileBrowserExpandNotification {
    export const type = new NotificationType<FileBrowserExpandResponse, void>(
        "filebrowser/expandcomplete",
    );
}

export interface FileBrowserExpandParams {
    ownerUri: string;
    // Path to expand
    expandPath: string;
}

export interface FileBrowserExpandResponse {
    ownerUri: string;
    expandPath: string;
    children: FileTreeNode[];
    succeeded: boolean;
    message: string;
}

export namespace FileBrowserCloseRequest {
    export const type = new RequestType<
        FileBrowserCloseParams,
        FileBrowserCloseResponse,
        void,
        void
    >("filebrowser/close");
}

export interface FileBrowserCloseParams {
    ownerUri: string;
}

export interface FileBrowserCloseResponse {
    succeeded: boolean;
    message: string;
}

//#endregion

export interface FileTree {
    rootNode: FileTreeNode;
    selectedNode: FileTreeNode;
}

export interface FileTreeNode {
    children: FileTreeNode[];
    isExpanded: boolean;
    isFile: boolean;
    name: string;
    fullPath: string;
}

//#region File Browser Webview Interfaces

export interface FileBrowserState {
    ownerUri: string;
    fileTree: FileTree;
    fileFilters: string[];
    showFoldersOnly: boolean;
    selectedPath: string;
}

export interface FileBrowserReducers {
    /**
     * Opens the file browser
     */
    openFileBrowser: {
        ownerUri: string;
        expandPath: string;
        fileFilters: string[];
        showFoldersOnly: boolean;
    };

    /**
     * Expands a node in the file tree
     */
    expandNode: { ownerUri: string; nodePath: string };

    /**
     * Closes the file browser
     */
    closeFileBrowser: { ownerUri: string };

    toggleFileBrowserDialog: { shouldOpen: boolean };
}

export interface FileBrowserProvider {
    /**
     * Opens the file browser
     * @param ownerUri the connection uri
     * @param expandPath the default path to expand
     * @param fileFilters the file filters to apply
     * @param showFoldersOnly  whether to show folders only
     */
    openFileBrowser(
        ownerUri: string,
        expandPath: string,
        fileFilters: string[],
        showFoldersOnly: boolean,
    ): void;

    /**
     * Expands a node in the file tree
     * @param ownerUri the connection uri
     * @param nodePath the path of the node to expand
     */
    expandNode(ownerUri: string, nodePath: string): void;

    /**
     * Closes the file browser
     * @param ownerUri the connection uri
     */
    closeFileBrowser(ownerUri: string): void;

    /**
     * Toggles the file browser dialog
     * @param shouldOpen whether the dialog should be open
     */
    toggleFileBrowserDialog(shouldOpen: boolean): void;
}

//#endregion
