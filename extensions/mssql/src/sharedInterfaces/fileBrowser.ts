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

//#endregion
