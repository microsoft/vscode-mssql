/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode } from "react";
import { DacFxApplicationWebviewState } from "../../../sharedInterfaces/dacFxApplication";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { WebviewRpc } from "../../common/rpc";

export interface DacFxApplicationReactProvider {
    extensionRpc: WebviewRpc<void>;
}

export const DacFxApplicationContext = createContext<DacFxApplicationReactProvider | undefined>(
    undefined,
);

interface DacFxApplicationProviderProps {
    children: ReactNode;
}

const DacFxApplicationStateProvider: React.FC<DacFxApplicationProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<DacFxApplicationWebviewState, void>();
    return (
        <DacFxApplicationContext.Provider value={{ extensionRpc }}>
            {children}
        </DacFxApplicationContext.Provider>
    );
};

export { DacFxApplicationStateProvider };
