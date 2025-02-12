/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResultSetSummary } from "./queryResult";

/**
 * The definition of an explorer tab.
 */
export interface ExplorerTab {
    /**
     * The title of the tab.
     */
    title: string;
    /**
     * The unique id of the tab.
     */
    id: string;
}

export interface ExplorerView {
    tabs: ExplorerTab[];
}

export interface TableExplorerWebviewState {
    view?: ExplorerView;
    resultSetSummaries?: Record<number, Record<number, ResultSetSummary>>;
    uri?: string;
    // fontSettings: FontSettings;
}

export interface TableExplorerReducers {
    // setTableExplorerResults: {
    //     results: number;
    // };
}

export interface TableDesignerComponentProperties {
    title?: string;
    ariaLabel?: string;
    width?: number;
    enabled?: boolean;
}

export interface TableExplorerReactProvider {
    openFileThroughLink(content: string, type: string): void;
}
