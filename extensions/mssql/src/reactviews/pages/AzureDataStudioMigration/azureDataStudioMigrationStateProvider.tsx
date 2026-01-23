/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { createContext, ReactNode } from "react";

import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { WebviewRpc } from "../../common/rpc";
import { AzureDataStudioMigrationWebviewState } from "../../../sharedInterfaces/azureDataStudioMigration";

export interface AzureDataStudioMigrationReactProvider {
    extensionRpc: WebviewRpc<void>;
}

export const AzureDataStudioMigrationContext = createContext<
    AzureDataStudioMigrationReactProvider | undefined
>(undefined);

interface AzureDataStudioMigrationProviderProps {
    children: ReactNode;
}

const AzureDataStudioMigrationStateProvider: React.FC<AzureDataStudioMigrationProviderProps> = ({
    children,
}) => {
    const { extensionRpc } = useVscodeWebview2<AzureDataStudioMigrationWebviewState, void>();
    return (
        <AzureDataStudioMigrationContext.Provider value={{ extensionRpc }}>
            {children}
        </AzureDataStudioMigrationContext.Provider>
    );
};

export { AzureDataStudioMigrationStateProvider };
