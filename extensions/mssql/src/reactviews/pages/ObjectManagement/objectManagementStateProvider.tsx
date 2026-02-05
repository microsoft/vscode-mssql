/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode } from "react";
import {
    ObjectManagementReducers,
    ObjectManagementWebviewState,
} from "../../../sharedInterfaces/objectManagement";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { WebviewRpc } from "../../common/rpc";

export interface ObjectManagementReactProvider {
    extensionRpc: WebviewRpc<ObjectManagementReducers>;
}

export const ObjectManagementContext = createContext<ObjectManagementReactProvider | undefined>(
    undefined,
);

interface ObjectManagementProviderProps {
    children: ReactNode;
}

const ObjectManagementStateProvider: React.FC<ObjectManagementProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<
        ObjectManagementWebviewState,
        ObjectManagementReducers
    >();
    return (
        <ObjectManagementContext.Provider value={{ extensionRpc }}>
            {children}
        </ObjectManagementContext.Provider>
    );
};

export { ObjectManagementStateProvider };
