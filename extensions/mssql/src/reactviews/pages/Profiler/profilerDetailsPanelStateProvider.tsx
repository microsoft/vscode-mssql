/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode, useContext, useCallback, useMemo } from "react";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import {
    ProfilerDetailsPanelState,
    ProfilerDetailsPanelReducers,
} from "../../../sharedInterfaces/profiler";

/**
 * RPC helper methods for Profiler Details Panel operations
 */
export interface ProfilerDetailsPanelRpcMethods {
    /** Open text data in a new VS Code editor */
    openInEditor: (textData: string, eventName?: string) => void;
    /** Copy text to clipboard */
    copyToClipboard: (text: string) => void;
}

export const ProfilerDetailsPanelContext = createContext<
    ProfilerDetailsPanelRpcMethods | undefined
>(undefined);

interface ProfilerDetailsPanelProviderProps {
    children: ReactNode;
}

/**
 * State provider for the Profiler Details Panel.
 * Provides RPC methods for actions. State is accessed via useProfilerDetailsPanelSelector.
 */
const ProfilerDetailsPanelStateProvider: React.FC<ProfilerDetailsPanelProviderProps> = ({
    children,
}) => {
    const { extensionRpc } = useVscodeWebview2<
        ProfilerDetailsPanelState,
        ProfilerDetailsPanelReducers
    >();

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

    const commands = useMemo<ProfilerDetailsPanelRpcMethods>(
        () => ({
            openInEditor,
            copyToClipboard,
        }),
        [openInEditor, copyToClipboard],
    );

    return (
        <ProfilerDetailsPanelContext.Provider value={commands}>
            {children}
        </ProfilerDetailsPanelContext.Provider>
    );
};

export const useProfilerDetailsPanelContext = (): ProfilerDetailsPanelRpcMethods => {
    const context = useContext(ProfilerDetailsPanelContext);
    if (!context) {
        throw new Error(
            "useProfilerDetailsPanelContext must be used within a ProfilerDetailsPanelStateProvider",
        );
    }
    return context;
};

export { ProfilerDetailsPanelStateProvider };
