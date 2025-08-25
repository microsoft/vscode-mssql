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
                loadWorkspaces: function (reloadWorkspacesWithTenantId?: string): void {
                    webviewState?.extensionRpc.action("loadWorkspaces", {
                        reloadWorkspacesWithTenantId: reloadWorkspacesWithTenantId,
                    });
                },
            }}>
            {children}
        </FabricProvisioningContext.Provider>
    );
};

export { FabricProvisioningContext, FabricProvisioningStateProvider };
