/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { WebviewRpc } from "../../common/rpc";
import { LanguageServiceStatsWebviewState } from "../../../sharedInterfaces/languageServiceStats";

export interface LanguageServiceStatsProvider {
    extensionRpc: WebviewRpc<void>;
}

export const LanguageServiceStatsContext = createContext<LanguageServiceStatsProvider | undefined>(
    undefined,
);

interface ProviderProps {
    children: ReactNode;
}

const LanguageServiceStatsStateProvider: React.FC<ProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<LanguageServiceStatsWebviewState, void>();
    return (
        <LanguageServiceStatsContext.Provider value={{ extensionRpc }}>
            {children}
        </LanguageServiceStatsContext.Provider>
    );
};

export { LanguageServiceStatsStateProvider };
