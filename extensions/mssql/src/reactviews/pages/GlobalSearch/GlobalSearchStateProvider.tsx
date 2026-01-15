/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, useContext, useMemo } from "react";
import {
    GlobalSearchWebViewState,
    GlobalSearchReducers,
    GlobalSearchContextProps,
} from "../../../sharedInterfaces/globalSearch";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../common/utils";

const GlobalSearchContext = createContext<GlobalSearchContextProps>(
    {} as GlobalSearchContextProps,
);

export const GlobalSearchStateProvider: React.FC<{
    children: React.ReactNode;
}> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<GlobalSearchWebViewState, GlobalSearchReducers>();

    const commands = useMemo<GlobalSearchContextProps>(
        () => ({
            ...getCoreRPCs2(extensionRpc),
            // Add context methods here as needed
        }),
        [extensionRpc],
    );

    return (
        <GlobalSearchContext.Provider value={commands}>{children}</GlobalSearchContext.Provider>
    );
};

export const useGlobalSearchContext = (): GlobalSearchContextProps => {
    const context = useContext(GlobalSearchContext);
    return context;
};
