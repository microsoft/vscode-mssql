/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ep from "../../../shared/executionPlanInterfaces";

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { ReactNode, createContext } from "react";
import { getCoreRPCs } from "../../common/utils";
import { WebviewContextProps } from "../../../shared/webview";

export interface ExecutionPlanContextProps
    extends WebviewContextProps<ep.ExecutionPlanWebviewState>,
        ep.ExecutionPlanProvider {}

const ExecutionPlanContext = createContext<ExecutionPlanContextProps | undefined>(undefined);

interface ExecutionPlanProviderProps {
    children: ReactNode;
}

const ExecutionPlanStateProvider: React.FC<ExecutionPlanProviderProps> = ({ children }) => {
    const webviewState = useVscodeWebview<ep.ExecutionPlanWebviewState, ep.ExecutionPlanReducers>();
    return (
        <ExecutionPlanContext.Provider
            value={{
                ...getCoreRPCs(webviewState),
                getExecutionPlan: function (): void {
                    webviewState?.extensionRpc.action("getExecutionPlan", {});
                },
                saveExecutionPlan: function (sqlPlanContent: string): void {
                    webviewState?.extensionRpc.action("saveExecutionPlan", {
                        sqlPlanContent: sqlPlanContent,
                    });
                },
                showPlanXml: function (sqlPlanContent: string): void {
                    webviewState?.extensionRpc.action("showPlanXml", {
                        sqlPlanContent: sqlPlanContent,
                    });
                },
                showQuery: function (query: string): void {
                    webviewState?.extensionRpc.action("showQuery", {
                        query: query,
                    });
                },
                updateTotalCost: function (addedCost: number): void {
                    webviewState?.extensionRpc.action("updateTotalCost", {
                        addedCost: addedCost,
                    });
                },
                state: webviewState?.state as ep.ExecutionPlanWebviewState,
                themeKind: webviewState?.themeKind,
            }}>
            {children}
        </ExecutionPlanContext.Provider>
    );
};

export { ExecutionPlanContext, ExecutionPlanStateProvider };
