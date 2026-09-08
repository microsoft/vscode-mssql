/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useMemo } from "react";

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { WebviewRpc } from "../../common/rpc";
import {
    NewJobRequest,
    SqlDiagnosticsReducers,
    SqlDiagnosticsState,
} from "../../../sharedInterfaces/sqlDiagnostics";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import type {
    QueryStoreConfiguration,
    QueryStoreMaintenanceAction,
    QueryStorePlanAction,
} from "sql-feature/diagnostics/querystore";

export interface SqlDiagnosticsContextProps {
    openResultText: (ranAt: string, rowIndex: number, field: string) => void;
    chooseDatabase: () => void;
    themeKind?: ColorThemeKind;
    extensionRpc: WebviewRpc<SqlDiagnosticsReducers>;

    runQuery: (queryId: string, params?: Record<string, unknown>) => void;
    recheckAgent: () => void;
    selectJob: (jobId: string) => void;
    jobAction: (jobId: string, action: "start" | "stop" | "enable" | "disable" | "delete") => void;
    createJob: (request: NewJobRequest) => void;
    setQueryStore: (enabled: boolean, configuration?: QueryStoreConfiguration) => void;
    queryStoreMaintenance: (action: QueryStoreMaintenanceAction) => void;
    inspectQueryStorePlan: (queryId: number, planId: number) => void;
    openQueryStorePlan: () => void;
    queryStorePlanAction: (queryId: number, planId: number, action: QueryStorePlanAction) => void;
    setQueryStoreHint: (queryId: number, hint: string) => void;
    clearQueryStoreHint: (queryId: number) => void;
    loadQueryStorePlans: (queryId: number) => void;
    refresh: () => void;
    exportCsv: () => void;
    openInEditor: (queryId: string) => void;
}

export const SqlDiagnosticsContext = createContext<SqlDiagnosticsContextProps | undefined>(
    undefined,
);

export const SqlDiagnosticsStateProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const { extensionRpc, themeKind } = useVscodeWebview<
        SqlDiagnosticsState,
        SqlDiagnosticsReducers
    >();

    const value = useMemo<SqlDiagnosticsContextProps>(
        () => ({
            openResultText: (ranAt, rowIndex, field) =>
                extensionRpc.action("openResultText", { ranAt, rowIndex, field }),
            chooseDatabase: () => extensionRpc.action("chooseDatabase", {}),
            themeKind,
            extensionRpc,
            runQuery: (queryId, params) => extensionRpc.action("runQuery", { queryId, params }),
            recheckAgent: () => extensionRpc.action("recheckAgent", {}),
            selectJob: (jobId) => extensionRpc.action("selectJob", { jobId }),
            jobAction: (jobId, action) => extensionRpc.action("jobAction", { jobId, action }),
            createJob: (request) => extensionRpc.action("createJob", { request }),
            setQueryStore: (enabled, configuration) =>
                extensionRpc.action("setQueryStore", { enabled, configuration }),
            queryStoreMaintenance: (action) =>
                extensionRpc.action("queryStoreMaintenance", { action }),
            inspectQueryStorePlan: (queryId, planId) =>
                extensionRpc.action("inspectQueryStorePlan", { queryId, planId }),
            openQueryStorePlan: () => extensionRpc.action("openQueryStorePlan", {}),
            queryStorePlanAction: (queryId, planId, action) =>
                extensionRpc.action("queryStorePlanAction", { queryId, planId, action }),
            setQueryStoreHint: (queryId, hint) =>
                extensionRpc.action("setQueryStoreHint", { queryId, hint }),
            clearQueryStoreHint: (queryId) =>
                extensionRpc.action("clearQueryStoreHint", { queryId }),
            loadQueryStorePlans: (queryId) =>
                extensionRpc.action("loadQueryStorePlans", { queryId }),
            refresh: () => extensionRpc.action("refresh", {}),
            exportCsv: () => extensionRpc.action("exportCsv", {}),
            openInEditor: (queryId) => extensionRpc.action("openInEditor", { queryId }),
        }),
        [extensionRpc, themeKind],
    );

    return (
        <SqlDiagnosticsContext.Provider value={value}>{children}</SqlDiagnosticsContext.Provider>
    );
};
