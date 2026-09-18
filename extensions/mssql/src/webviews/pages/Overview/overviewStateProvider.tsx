/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode, useContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { WebviewRpc } from "../../common/rpc";
import { OverviewReducers, OverviewWebviewState } from "../../../sharedInterfaces/overview";

export interface OverviewReactProvider {
    extensionRpc: WebviewRpc<OverviewReducers>;
}

export const OverviewContext = createContext<OverviewReactProvider | undefined>(undefined);

interface OverviewProviderProps {
    children: ReactNode;
}

const OverviewStateProvider: React.FC<OverviewProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<OverviewWebviewState, OverviewReducers>();
    return <OverviewContext.Provider value={{ extensionRpc }}>{children}</OverviewContext.Provider>;
};

/** Access the Overview page's RPC channel to the extension. */
export function useOverviewContext(): OverviewReactProvider {
    const context = useContext(OverviewContext);
    if (!context) {
        throw new Error("useOverviewContext must be used within an OverviewStateProvider");
    }
    return context;
}

export { OverviewStateProvider };
