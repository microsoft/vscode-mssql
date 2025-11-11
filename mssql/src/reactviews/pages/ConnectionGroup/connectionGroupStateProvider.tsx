/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from "react";
import { createContext } from "react";
import {
    ConnectionGroupContextProps,
    ConnectionGroupReducers,
    ConnectionGroupSpec,
    ConnectionGroupState,
} from "../../../sharedInterfaces/connectionGroup";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";

const ConnectionGroupContext = createContext<ConnectionGroupContextProps | undefined>(undefined);

interface ConnectionGroupProviderProps {
    children: React.ReactNode;
}

// Connection Group State Provider component
const ConnectionGroupStateProvider: React.FC<ConnectionGroupProviderProps> = ({ children }) => {
    const webviewContext = useVscodeWebview<ConnectionGroupState, ConnectionGroupReducers>();

    return (
        <ConnectionGroupContext.Provider
            value={{
                state: webviewContext.state,
                themeKind: webviewContext.themeKind,
                keyBindings: webviewContext.keyBindings,
                ...getCoreRPCs(webviewContext),
                closeDialog: () => webviewContext?.extensionRpc.action("closeDialog"),
                saveConnectionGroup: (connectionGroupSpec: ConnectionGroupSpec) =>
                    webviewContext?.extensionRpc.action("saveConnectionGroup", connectionGroupSpec),
            }}>
            {children}
        </ConnectionGroupContext.Provider>
    );
};

export { ConnectionGroupContext, ConnectionGroupStateProvider };
