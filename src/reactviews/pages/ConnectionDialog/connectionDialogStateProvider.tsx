/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    ConnectionDialogContextProps,
    ConnectionDialogReducers,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";

const ConnectionDialogContext = createContext<
    ConnectionDialogContextProps | undefined
>(undefined);

interface ConnectionDialogProviderProps {
    children: React.ReactNode;
}

const ConnectionDialogStateProvider: React.FC<
    ConnectionDialogProviderProps
> = ({ children }) => {
    const webviewState = useVscodeWebview<
        ConnectionDialogWebviewState,
        ConnectionDialogReducers
    >();
    const connectionDialogState = webviewState?.state;
    return (
        <ConnectionDialogContext.Provider
            value={{
                state: connectionDialogState,
                theme: webviewState?.theme,
                loadConnection: function (
                    connection: IConnectionDialogProfile,
                ): void {
                    webviewState?.extensionRpc.action("loadConnection", {
                        connection: connection,
                    });
                },
                formAction: function (event): void {
                    webviewState?.extensionRpc.action("formAction", {
                        event: event,
                    });
                },
                setConnectionInputType: function (
                    inputMode: ConnectionInputMode,
                ): void {
                    webviewState?.extensionRpc.action(
                        "setConnectionInputType",
                        {
                            inputMode: inputMode,
                        },
                    );
                },
                connect: function (): void {
                    webviewState?.extensionRpc.action("connect");
                },
            }}
        >
            {children}
        </ConnectionDialogContext.Provider>
    );
};

export { ConnectionDialogContext, ConnectionDialogStateProvider };
