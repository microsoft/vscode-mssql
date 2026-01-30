/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode, useContext, useCallback } from "react";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { WebviewRpc } from "../../common/rpc";
import { ProfilerWebviewState, ProfilerReducers } from "../../../sharedInterfaces/profiler";

/**
 * RPC helper methods for Profiler operations
 */
export interface ProfilerRpcMethods {
    /** Pause or resume the profiler session */
    pauseResume: () => Promise<void>;
    /** Stop the profiler session */
    stop: () => Promise<void>;
    /** Create a new profiler session */
    createSession: (templateId: string, sessionName: string) => Promise<void>;
    /** Start a profiler session */
    startSession: (sessionId: string) => Promise<void>;
    /** Select a session */
    selectSession: (sessionId: string) => void;
    /** Clear events up to localRowCount (the rows currently shown in the grid) */
    clearEvents: (localRowCount: number) => void;
    /** Change the current view */
    changeView: (viewId: string) => Promise<void>;
    /** Toggle auto-scroll */
    toggleAutoScroll: () => void;
    /** Fetch rows from the buffer (pull model for infinite scroll) */
    fetchRows: (startIndex: number, count: number) => void;
    /** Select a row to show details in the panel */
    selectRow: (rowId: string) => void;
    /** Open TextData content in a new VS Code editor (embedded details panel) */
    openInEditor: (textData: string, eventName?: string) => void;
    /** Copy text to clipboard (embedded details panel) */
    copyToClipboard: (text: string) => void;
    /** Close the embedded details panel */
    closeDetailsPanel: () => void;
}

export interface ProfilerReactProvider extends ProfilerRpcMethods {
    extensionRpc: WebviewRpc<ProfilerReducers>;
}

export const ProfilerContext = createContext<ProfilerReactProvider | undefined>(undefined);

interface ProfilerProviderProps {
    children: ReactNode;
}

const ProfilerStateProvider: React.FC<ProfilerProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<ProfilerWebviewState, ProfilerReducers>();

    const pauseResume = useCallback(async () => {
        extensionRpc?.action("pauseResume", {});
    }, [extensionRpc]);

    const stop = useCallback(async () => {
        extensionRpc?.action("stop", {});
    }, [extensionRpc]);

    const createSession = useCallback(
        async (templateId: string, sessionName: string) => {
            extensionRpc?.action("createSession", { templateId, sessionName });
        },
        [extensionRpc],
    );

    const startSession = useCallback(
        async (sessionId: string) => {
            extensionRpc?.action("startSession", { sessionId });
        },
        [extensionRpc],
    );

    const selectSession = useCallback(
        (sessionId: string) => {
            extensionRpc?.action("selectSession", { sessionId });
        },
        [extensionRpc],
    );

    const clearEvents = useCallback(
        (localRowCount: number) => {
            // Clear events from 0 to localRowCount in the RingBuffer
            extensionRpc?.action("clearEvents", { localRowCount });
        },
        [extensionRpc],
    );

    const changeView = useCallback(
        async (viewId: string) => {
            extensionRpc?.action("changeView", { viewId });
        },
        [extensionRpc],
    );

    const toggleAutoScroll = useCallback(() => {
        extensionRpc?.action("toggleAutoScroll", {});
    }, [extensionRpc]);

    const fetchRows = useCallback(
        (startIndex: number, count: number) => {
            extensionRpc?.action("fetchRows", { startIndex, count });
        },
        [extensionRpc],
    );

    const selectRow = useCallback(
        (rowId: string) => {
            extensionRpc?.action("selectRow", { rowId });
        },
        [extensionRpc],
    );

    const openInEditor = useCallback(
        (textData: string, eventName?: string) => {
            extensionRpc?.action("openInEditor", { textData, eventName });
        },
        [extensionRpc],
    );

    const copyToClipboard = useCallback(
        (text: string) => {
            extensionRpc?.action("copyToClipboard", { text });
        },
        [extensionRpc],
    );

    const closeDetailsPanel = useCallback(() => {
        extensionRpc?.action("closeDetailsPanel", {});
    }, [extensionRpc]);

    return (
        <ProfilerContext.Provider
            value={{
                extensionRpc,
                pauseResume,
                stop,
                createSession,
                startSession,
                selectSession,
                clearEvents,
                changeView,
                toggleAutoScroll,
                fetchRows,
                selectRow,
                openInEditor,
                copyToClipboard,
                closeDetailsPanel,
            }}>
            {children}
        </ProfilerContext.Provider>
    );
};

export const useProfilerContext = (): ProfilerReactProvider => {
    const context = useContext(ProfilerContext);
    if (!context) {
        throw new Error("useProfilerContext must be used within a ProfilerStateProvider");
    }
    return context;
};

export { ProfilerStateProvider };
