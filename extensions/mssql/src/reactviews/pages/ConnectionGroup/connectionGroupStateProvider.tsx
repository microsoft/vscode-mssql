/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import { createContext, useMemo } from "react";
import {
    ConnectionGroupContextProps,
    ConnectionGroupReducers,
    ConnectionGroupSpec,
    ConnectionGroupState,
} from "../../../sharedInterfaces/connectionGroup";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs } from "../../common/utils";

const ConnectionGroupContext = createContext<ConnectionGroupContextProps | undefined>(undefined);

interface ConnectionGroupProviderProps {
    children: React.ReactNode;
}

// Connection Group State Provider component
const ConnectionGroupStateProvider: React.FC<ConnectionGroupProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<ConnectionGroupState, ConnectionGroupReducers>();

    const commands = useMemo<ConnectionGroupContextProps>(
        () => ({
            ...getCoreRPCs(extensionRpc),
            closeDialog: () => extensionRpc.action("closeDialog"),
            saveConnectionGroup: (connectionGroupSpec: ConnectionGroupSpec) =>
                extensionRpc.action("saveConnectionGroup", connectionGroupSpec),
        }),
        [extensionRpc],
    );

    return (
        <ConnectionGroupContext.Provider value={commands}>
            {children}
        </ConnectionGroupContext.Provider>
    );
};

export { ConnectionGroupContext, ConnectionGroupStateProvider };
