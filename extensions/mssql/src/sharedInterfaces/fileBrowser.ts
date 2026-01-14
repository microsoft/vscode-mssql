/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDialogProps } from "./connectionDialog";

//#region Sql Tools Service Interfaces

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

export type FileBrowserWebviewState = {
    fileBrowserState: FileBrowserState;
    dialog: IDialogProps | undefined;
    ownerUri: string;
    defaultFileBrowserExpandPath: string;
};

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
        changeFilter: boolean;
        showFoldersOnly: boolean;
    };

    /**
     * Expands a node in the file tree
     */
    expandNode: { ownerUri: string; nodePath: string };

    /**
     * Submits the selected file path
     */
    submitFilePath: { selectedPath: string };

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
     * @param changeFilter whether to change the filter
     * @param showFoldersOnly  whether to show folders only
     */
    openFileBrowser(
        ownerUri: string,
        expandPath: string,
        fileFilters: string[],
        changeFilter: boolean,
        showFoldersOnly: boolean,
    ): void;

    /**
     * Expands a node in the file tree
     * @param ownerUri the connection uri
     * @param nodePath the path of the node to expand
     */
    expandNode(ownerUri: string, nodePath: string): void;

    /**
     * Submits the selected file path
     * @param selectedPath the selected file path
     */
    submitFilePath(selectedPath: string): void;

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

export interface FileTypeOption {
    displayName: string;
    value: string[];
}

//#endregion
