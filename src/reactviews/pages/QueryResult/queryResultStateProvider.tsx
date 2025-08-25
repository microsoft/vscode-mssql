/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext, useMemo } from "react";
import { getCoreRPCs2 } from "../../common/utils";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { ExecutionPlanProvider } from "../../../sharedInterfaces/executionPlan";
import {
    CoreRPCs,
    ExecuteCommandRequest,
    GetPlatformRequest,
} from "../../../sharedInterfaces/webview";
import {
    GetColumnWidthsParams,
    GetColumnWidthsRequest,
    GetFiltersParams,
    GetFiltersRequest,
    GetGridPaneScrollPositionParams,
    GetGridPaneScrollPositionRequest,
    GetGridPaneScrollPositionResponse,
    GetGridScrollPositionParams,
    GetGridScrollPositionRequest,
    GetGridScrollPositionResponse,
    GetRowsParams,
    GetRowsRequest,
    GetWebviewLocationRequest,
    GridColumnMap,
    OpenInNewTabParams,
    OpenInNewTabRequest,
    QueryResultPaneTabs,
    QueryResultReducers,
    QueryResultViewMode,
    QueryResultWebviewLocation,
    QueryResultWebviewState,
    ResultSetSubset,
    SaveResultsWebviewParams,
    SaveResultsWebviewRequest,
    SetColumnWidthsParams,
    SetColumnWidthsRequest,
    SetEditorSelectionParams,
    SetEditorSelectionRequest,
    SetGridPaneScrollPositionNotification,
    SetGridPaneScrollPositionParams,
    SetGridScrollPositionNotification,
    SetGridScrollPositionParams,
} from "../../../sharedInterfaces/queryResult";
import { WebviewRpc } from "../../common/rpc";

export interface QueryResultReactProvider
    extends Omit<ExecutionPlanProvider, "getExecutionPlan">,
        CoreRPCs {
    extensionRpc: WebviewRpc<QueryResultReducers>;
    setResultTab: (tabId: QueryResultPaneTabs) => void;
    setResultViewMode: (viewMode: QueryResultViewMode) => void;
    /**
     * Gets the execution plan graph from the provider for a result set
     * @param uri the uri of the query result state this request is associated with
     */
    getExecutionPlan(uri: string): void;

    /**
     * Opens a file of type with with specified content
     * @param content the content of the file
     * @param type the type of file to open
     */
    openFileThroughLink(content: string, type: string): void;
    getColumnWidths(params: GetColumnWidthsParams): Promise<number[]>;
    setColumnWidths(params: SetColumnWidthsParams): Promise<void>;
    getScrollPosition(params: GetGridScrollPositionParams): Promise<GetGridScrollPositionResponse>;
    setGridScrollPosition(params: SetGridScrollPositionParams): Promise<void>;
    getFilter(params: GetFiltersParams): Promise<GridColumnMap[]>;

    saveResults(params: SaveResultsWebviewParams): Promise<void>;
    getRows(params: GetRowsParams): Promise<ResultSetSubset>;
    setEditorSelection(params: SetEditorSelectionParams): Promise<void>;
    getWebviewLocation(): Promise<QueryResultWebviewLocation>;
    getGridPaneScrollPosition(
        params: GetGridPaneScrollPositionParams,
    ): Promise<GetGridPaneScrollPositionResponse>;
    setGridPaneScrollPosition: (params: SetGridPaneScrollPositionParams) => Promise<void>;
    closePanel: () => Promise<void>;
    openInNewTab: (params: OpenInNewTabParams) => Promise<void>;
    getPlatform(): Promise<string>;
}

export const QueryResultCommandsContext = createContext<QueryResultReactProvider | undefined>(
    undefined,
);

interface QueryResultProviderProps {
    children: ReactNode;
}

const QueryResultStateProvider: React.FC<QueryResultProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<QueryResultWebviewState, QueryResultReducers>();

    const commands = useMemo<QueryResultReactProvider>(
        () => ({
            extensionRpc,
            ...getCoreRPCs2<QueryResultReducers>(extensionRpc),
            setResultTab: (tabId: QueryResultPaneTabs) => {
                extensionRpc.action("setResultTab", { tabId });
            },
            setResultViewMode: (viewMode: QueryResultViewMode) => {
                extensionRpc.action("setResultViewMode", { viewMode });
            },

            openFileThroughLink: (content: string, type: string) => {
                extensionRpc.action("openFileThroughLink", { content, type });
            },
            getColumnWidths: (params: GetColumnWidthsParams) => {
                return extensionRpc.sendRequest(GetColumnWidthsRequest.type, params);
            },
            setColumnWidths: (params: SetColumnWidthsParams) => {
                return extensionRpc.sendRequest(SetColumnWidthsRequest.type, params);
            },
            getScrollPosition: (params: GetGridScrollPositionParams) => {
                return extensionRpc.sendRequest(GetGridScrollPositionRequest.type, params);
            },
            setGridScrollPosition: (params: SetGridScrollPositionParams) => {
                return extensionRpc.sendNotification(
                    SetGridScrollPositionNotification.type,
                    params,
                );
            },
            getFilter: (params: GetFiltersParams) => {
                return extensionRpc.sendRequest(GetFiltersRequest.type, params);
            },

            // NEW

            saveResults: (params: SaveResultsWebviewParams) => {
                return extensionRpc.sendRequest(SaveResultsWebviewRequest.type, params);
            },
            getRows: (params: GetRowsParams) => {
                return extensionRpc.sendRequest(GetRowsRequest.type, params);
            },
            setEditorSelection: (params: SetEditorSelectionParams) => {
                return extensionRpc.sendRequest(SetEditorSelectionRequest.type, params);
            },
            getWebviewLocation: () => {
                return extensionRpc.sendRequest(GetWebviewLocationRequest.type);
            },
            getGridPaneScrollPosition: (params: GetGridPaneScrollPositionParams) => {
                return extensionRpc.sendRequest(GetGridPaneScrollPositionRequest.type, params);
            },
            setGridPaneScrollPosition: (params: SetGridPaneScrollPositionParams) => {
                return extensionRpc.sendNotification(
                    SetGridPaneScrollPositionNotification.type,
                    params,
                );
            },
            closePanel: () => {
                return extensionRpc.sendRequest(ExecuteCommandRequest.type, {
                    command: "workbench.action.closePanel",
                });
            },
            openInNewTab: (params: OpenInNewTabParams) => {
                return extensionRpc.sendRequest(OpenInNewTabRequest.type, params);
            },
            getPlatform: () => {
                return extensionRpc.sendRequest(GetPlatformRequest.type);
            },

            // Execution Plan commands

            /**
             * Gets the execution plan for a specific query result
             * @param uri the uri of the query result state this request is associated with
             */
            getExecutionPlan: (uri: string) => {
                extensionRpc.action("getExecutionPlan", { uri });
            },
            /**
             * Saves the execution plan for a specific query result
             * @param sqlPlanContent the content of the SQL plan to save
             */
            saveExecutionPlan: (sqlPlanContent: string) => {
                extensionRpc.action("saveExecutionPlan", { sqlPlanContent });
            },
            /**
             * Shows the XML representation of the execution plan for a specific query result
             * @param sqlPlanContent the content of the SQL plan to show
             */
            showPlanXml: (sqlPlanContent: string) => {
                extensionRpc.action("showPlanXml", { sqlPlanContent });
            },
            /**
             * Shows the query for a specific query result
             * @param query the query to show
             */
            showQuery: (query: string) => {
                extensionRpc.action("showQuery", { query });
            },
            /**
             * Updates the total cost for a specific query result
             * @param addedCost the cost to add to the total
             */
            updateTotalCost: (addedCost: number) => {
                extensionRpc.action("updateTotalCost", { addedCost });
            },
        }),
        [extensionRpc],
    );
    return (
        <QueryResultCommandsContext.Provider value={commands}>
            {children}
        </QueryResultCommandsContext.Provider>
    );
};

export { QueryResultStateProvider };
