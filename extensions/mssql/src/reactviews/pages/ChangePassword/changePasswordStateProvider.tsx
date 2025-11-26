/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode } from "react";
import { ChangePasswordWebviewState } from "../../../sharedInterfaces/changePassword";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { WebviewRpc } from "../../common/rpc";

export interface ChangePasswordReactProvider {
    extensionRpc: WebviewRpc<void>;
}

export const ChangePasswordContext = createContext<ChangePasswordReactProvider | undefined>(
    undefined,
);

interface ChangePasswordProviderProps {
    children: ReactNode;
}

const ChangePasswordStateProvider: React.FC<ChangePasswordProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<ChangePasswordWebviewState, void>();
    return (
        <ChangePasswordContext.Provider value={{ extensionRpc }}>
            {children}
        </ChangePasswordContext.Provider>
    );
};

export { ChangePasswordStateProvider };
