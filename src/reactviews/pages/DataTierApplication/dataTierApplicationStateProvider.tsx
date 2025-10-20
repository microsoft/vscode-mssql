/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode } from "react";
import { DataTierApplicationWebviewState } from "../../../sharedInterfaces/dataTierApplication";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { WebviewRpc } from "../../common/rpc";

export interface DataTierApplicationReactProvider {
    extensionRpc: WebviewRpc<void>;
}

export const DataTierApplicationContext = createContext<
    DataTierApplicationReactProvider | undefined
>(undefined);

interface DataTierApplicationProviderProps {
    children: ReactNode;
}

const DataTierApplicationStateProvider: React.FC<DataTierApplicationProviderProps> = ({
    children,
}) => {
    const { extensionRpc } = useVscodeWebview2<DataTierApplicationWebviewState, void>();
    return (
        <DataTierApplicationContext.Provider value={{ extensionRpc }}>
            {children}
        </DataTierApplicationContext.Provider>
    );
};

export { DataTierApplicationStateProvider };
