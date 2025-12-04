/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode } from "react";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { WebviewRpc } from "../../common/rpc";
import { ChangelogWebviewState } from "../../../sharedInterfaces/changelog";

export interface ChangelogReactProvider {
    extensionRpc: WebviewRpc<void>;
}

export const ChangelogContext = createContext<ChangelogReactProvider | undefined>(undefined);

interface ChangelogProviderProps {
    children: ReactNode;
}

const ChangelogStateProvider: React.FC<ChangelogProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<ChangelogWebviewState, void>();
    return (
        <ChangelogContext.Provider value={{ extensionRpc }}>{children}</ChangelogContext.Provider>
    );
};

export { ChangelogStateProvider };
