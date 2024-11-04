/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as qr from "../../../sharedInterfaces/queryResult";

import {
    ColorThemeKind,
    useVscodeWebview,
} from "../../common/vscodeWebviewProvider";
import { ReactNode, createContext } from "react";

export interface QueryResultState {
    provider: qr.QueryResultReactProvider;
    state: qr.QueryResultWebviewState;
    theme: ColorThemeKind;
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
                provider: {
                    setResultTab: function (
                        tabId: qr.QueryResultPaneTabs,
                    ): void {
                        webViewState?.extensionRpc.action("setResultTab", {
                            tabId: tabId,
                        });
                    },
                    getExecutionPlan: function (xmlPlans: string[]): void {
                        webViewState?.extensionRpc.action("getExecutionPlan", {
                            xmlPlans: xmlPlans,
                        });
                    },
                    addXmlPlan: function (plan: string): void {
                        webViewState?.extensionRpc.action("addXmlPlan", {
                            xmlPlan: plan,
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
                },

                state: webViewState?.state as qr.QueryResultWebviewState,
                theme: webViewState?.themeKind,
            }}
        >
            {children}
        </QueryResultContext.Provider>
    );
};

export { QueryResultContext, QueryResultStateProvider };
