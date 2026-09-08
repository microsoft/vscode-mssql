/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useMemo } from "react";

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { WebviewRpc } from "../../common/rpc";
import {
    ProfilerViewMode,
    SqlProfilerReducers,
    SqlProfilerState,
} from "../../../sharedInterfaces/sqlProfiler";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";

export interface SqlProfilerContextProps {
    themeKind?: ColorThemeKind;
    extensionRpc: WebviewRpc<SqlProfilerReducers>;

    start: (sessionName: string) => void;
    stop: () => void;
    clear: () => void;
    setViewMode: (mode: ProfilerViewMode) => void;
    setAutoScroll: (enabled: boolean) => void;
    refreshSessions: () => void;
    createSession: (templateId: string) => void;
    setPaused: (paused: boolean, byUser?: boolean) => void;
    setFilter: (text: string) => void;
    selectRow: (rowId?: number) => void;
    cleanUpOrphans: () => void;
    dropSession: (sessionName: string) => void;
    saveCapture: () => void;
    exportCsv: () => void;
    showPlan: (rowId: number) => void;
    filterToQuery: (key: string) => void;
}

export const SqlProfilerContext = createContext<SqlProfilerContextProps | undefined>(undefined);

export const SqlProfilerStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { extensionRpc, themeKind } = useVscodeWebview<SqlProfilerState, SqlProfilerReducers>();

    const value = useMemo<SqlProfilerContextProps>(
        () => ({
            themeKind,
            extensionRpc,
            start: (sessionName) => extensionRpc.action("start", { sessionName }),
            stop: () => extensionRpc.action("stop", {}),
            clear: () => extensionRpc.action("clear", {}),
            setViewMode: (mode) => extensionRpc.action("setViewMode", { mode }),
            setAutoScroll: (enabled) => extensionRpc.action("setAutoScroll", { enabled }),
            refreshSessions: () => extensionRpc.action("refreshSessions", {}),
            createSession: (templateId: string) =>
                extensionRpc.action("createSession", { templateId }),
            setPaused: (paused: boolean, byUser?: boolean) =>
                extensionRpc.action("setPaused", { paused, byUser }),
            setFilter: (text: string) => extensionRpc.action("setFilter", { text }),
            selectRow: (rowId?: number) => extensionRpc.action("selectRow", { rowId }),
            cleanUpOrphans: () => extensionRpc.action("cleanUpOrphans", {}),
            dropSession: (sessionName) => extensionRpc.action("dropSession", { sessionName }),
            saveCapture: () => extensionRpc.action("saveCapture", {}),
            exportCsv: () => extensionRpc.action("exportCsv", {}),
            showPlan: (rowId) => extensionRpc.action("showPlan", { rowId }),
            filterToQuery: (key) => extensionRpc.action("filterToQuery", { key }),
        }),
        [extensionRpc, themeKind],
    );

    return <SqlProfilerContext.Provider value={value}>{children}</SqlProfilerContext.Provider>;
};
