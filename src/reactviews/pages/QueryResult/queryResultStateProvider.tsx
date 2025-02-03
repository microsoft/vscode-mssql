/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as qr from "../../../sharedInterfaces/queryResult";

import {
    useVscodeWebview,
    WebviewContextProps,
} from "../../common/vscodeWebviewProvider";
import { ReactNode, createContext } from "react";
import { ColumnFilterState } from "./table/interfaces";
import { getCoreRPCs } from "../../common/utils";

export interface QueryResultState
    extends WebviewContextProps<qr.QueryResultWebviewState> {
    provider: qr.QueryResultReactProvider;
}

const QueryResultContext = createContext<QueryResultState | undefined>(
    undefined,
);

interface QueryResultContextProps {
    children: ReactNode;
}

const QueryResultStateProvider: React.FC<QueryResultContextProps> = ({
    children,
}) => {
    const webViewState = useVscodeWebview<
        qr.QueryResultWebviewState,
        qr.QueryResultReducers
    >();
    // const queryResultState = webViewState?.state as qr.QueryResultWebviewState;
    return (
        <QueryResultContext.Provider
            value={{
                ...getCoreRPCs(webViewState),
                provider: {
                    setResultTab: function (
                        tabId: qr.QueryResultPaneTabs,
                    ): void {
                        webViewState?.extensionRpc.action("setResultTab", {
                            tabId: tabId,
                        });
                    },
                    setFilterState: function (
                        filterState: ColumnFilterState,
                    ): void {
                        webViewState?.extensionRpc.action("setFilterState", {
                            filterState: filterState,
                        });
                    },
                    getExecutionPlan: function (uri: string): void {
                        webViewState?.extensionRpc.action("getExecutionPlan", {
                            uri: uri,
                        });
                    },
                    openFileThroughLink: function (
                        content: string,
                        type: string,
                    ): void {
                        webViewState?.extensionRpc.action(
                            "openFileThroughLink",
                            {
                                content: content,
                                type: type,
                            },
                        );
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
                },

                state: webViewState?.state as qr.QueryResultWebviewState,
                themeKind: webViewState?.themeKind,
            }}
        >
            {children}
        </QueryResultContext.Provider>
    );
};

export { QueryResultContext, QueryResultStateProvider };
