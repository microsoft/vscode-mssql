/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The definition of a designer tab.
 */
export interface ExplorerTab {
    /**
     * The title of the tab.
     */
    title: string;
    id: string;
}

export interface ExplorerView {
    tabs: ExplorerTab[];
}

export interface TableExplorerWebviewState {
    view: ExplorerView;
}

export interface TableExplorerReducers {}
