/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cd from "./containerDeploymentInterfaces";

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { createContext } from "react";
import { ContainerDeploymentContextProps } from "./containerDeploymentInterfaces";
import { getCoreRPCs } from "../../common/utils";

const ContainerDeploymentContext = createContext<
    ContainerDeploymentContextProps | undefined
>(undefined);

interface ContainerDeploymentProviderProps {
    children: React.ReactNode;
}

const ContainerDeploymentStateProvider: React.FC<
    ContainerDeploymentProviderProps
> = ({ children }) => {
    const webviewState = useVscodeWebview<
        cd.ContainerDeploymentWebviewState,
        cd.ContainerDeploymentReducers
    >();
    return (
        <ContainerDeploymentContext.Provider
            value={{
                state: webviewState?.state,
                themeKind: webviewState?.themeKind,
                ...getCoreRPCs(webviewState),
                formAction: function (event): void {
                    webviewState?.extensionRpc.action("formAction", {
                        event: event,
                    });
                },
                checkDockerInstallation: function (): void {
                    webviewState?.extensionRpc.action(
                        "checkDockerInstallation",
                        {},
                    );
                },
                startDocker: function (): void {
                    webviewState?.extensionRpc.action("startDocker", {});
                },
                checkLinuxEngine: function (): void {
                    webviewState?.extensionRpc.action("checkLinuxEngine", {});
                },
                startContainer: function (): void {
                    webviewState?.extensionRpc.action("startContainer", {});
                },
                checkContainer: function (): void {
                    webviewState?.extensionRpc.action("checkContainer", {});
                },
                connectToContainer: function (): void {
                    webviewState?.extensionRpc.action("connectToContainer", {});
                },
                dispose: function (): void {
                    webviewState?.extensionRpc.action("dispose", {});
                },
            }}
        >
            {children}
        </ContainerDeploymentContext.Provider>
    );
};

export { ContainerDeploymentContext, ContainerDeploymentStateProvider };
