/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as qr from "../../../sharedInterfaces/queryResult";

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { ReactNode, createContext } from "react";
import { getCoreRPCs } from "../../common/utils";
import { WebviewContextProps } from "../../../sharedInterfaces/webview";

export interface QueryResultContextProps
    extends WebviewContextProps<qr.QueryResultWebviewState>,
        qr.QueryResultReactProvider {}

const QueryResultContext = createContext<QueryResultContextProps | undefined>(undefined);

interface QueryResultProviderProps {
    children: ReactNode;
}

const QueryResultStateProvider: React.FC<QueryResultProviderProps> = ({ children }) => {
    const webViewState = useVscodeWebview<qr.QueryResultWebviewState, qr.QueryResultReducers>();
    // const queryResultState = webViewState?.state as qr.QueryResultWebviewState;
    return (
        <QueryResultContext.Provider
            value={{
                ...getCoreRPCs(webViewState),
                setResultTab: function (tabId: qr.QueryResultPaneTabs): void {
                    webViewState?.extensionRpc.action("setResultTab", {
                        tabId: tabId,
                    });
                },
                setResultViewMode: function (viewMode: qr.QueryResultViewMode): void {
                    webViewState?.extensionRpc.action("setResultViewMode", {
                        viewMode: viewMode,
                    });
                },
                getExecutionPlan: function (uri: string): void {
                    webViewState?.extensionRpc.action("getExecutionPlan", {
                        uri: uri,
                    });
                },
                openFileThroughLink: function (content: string, type: string): void {
                    webViewState?.extensionRpc.action("openFileThroughLink", {
                        content: content,
                        type: type,
                    });
                },
                saveExecutionPlan: function (sqlPlanContent: string): void {
                    webViewState?.extensionRpc.action("saveExecutionPlan", {
                        sqlPlanContent: sqlPlanContent,
                    });
                },
                showPlanXml: function (sqlPlanContent: string): void {
                    webViewState?.extensionRpc.action("showPlanXml", {
                        sqlPlanContent: sqlPlanContent,
                    });
                },
                showQuery: function (query: string): void {
                    webViewState?.extensionRpc.action("showQuery", {
                        query: query,
                    });
                },
                updateTotalCost: function (addedCost: number): void {
                    webViewState?.extensionRpc.action("updateTotalCost", {
                        addedCost: addedCost,
                    });
                },

                state: webViewState?.state as qr.QueryResultWebviewState,
                themeKind: webViewState?.themeKind,
            }}>
            {children}
        </QueryResultContext.Provider>
    );
};

export { QueryResultContext, QueryResultStateProvider };
