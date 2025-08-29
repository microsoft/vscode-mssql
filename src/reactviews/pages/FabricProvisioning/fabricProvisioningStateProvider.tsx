/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { createContext } from "react";

import { getCoreRPCs } from "../../common/utils";
import {
    FabricProvisioningContextProps,
    FabricProvisioningWebviewState,
    FabricProvisioningReducers,
} from "../../../sharedInterfaces/fabricProvisioning";
import { ConnectionGroupSpec } from "../../../sharedInterfaces/connectionGroup";

const FabricProvisioningContext = createContext<FabricProvisioningContextProps | undefined>(
    undefined,
);

interface FabricProvisioningProviderProps {
    children: React.ReactNode;
}

const FabricProvisioningStateProvider: React.FC<FabricProvisioningProviderProps> = ({
    children,
}) => {
    const webviewState = useVscodeWebview<
        FabricProvisioningWebviewState,
        FabricProvisioningReducers
    >();
    return (
        <FabricProvisioningContext.Provider
            value={{
                state: webviewState?.state,
                themeKind: webviewState?.themeKind,
                ...getCoreRPCs(webviewState),
                formAction: function (event): void {
                    webviewState?.extensionRpc.action("formAction", {
                        event: event,
                    });
                },
                reloadFabricEnvironment: function (newTenant: string): void {
                    webviewState?.extensionRpc.action("reloadFabricEnvironment", {
                        newTenant: newTenant,
                    });
                },
                handleWorkspaceFormAction: function (workspaceId: string): void {
                    webviewState?.extensionRpc.action("handleWorkspaceFormAction", {
                        workspaceId: workspaceId,
                    });
                },
                createDatabase: function (): void {
                    webviewState?.extensionRpc.action("createDatabase", {});
                },
                createConnectionGroup: function (connectionGroupSpec: ConnectionGroupSpec): void {
                    webviewState?.extensionRpc.action("createConnectionGroup", {
                        connectionGroupSpec: connectionGroupSpec,
                    });
                },
                setConnectionGroupDialogState: function (shouldOpen: boolean): void {
                    webviewState?.extensionRpc.action("setConnectionGroupDialogState", {
                        shouldOpen: shouldOpen,
                    });
                },
                dispose: function (): void {
                    webviewState?.extensionRpc.action("dispose", {});
                },
            }}>
            {children}
        </FabricProvisioningContext.Provider>
    );
};

export { FabricProvisioningContext, FabricProvisioningStateProvider };
