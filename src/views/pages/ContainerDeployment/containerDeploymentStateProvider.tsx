/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cd from "../../../sharedInterfaces/containerDeploymentInterfaces";

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { createContext } from "react";
import { ContainerDeploymentContextProps } from "../../../sharedInterfaces/containerDeploymentInterfaces";
import { getCoreRPCs } from "../../common/utils";
import { ConnectionGroupSpec } from "../../../sharedInterfaces/connectionGroup";

const ContainerDeploymentContext = createContext<ContainerDeploymentContextProps | undefined>(
    undefined,
);

interface ContainerDeploymentProviderProps {
    children: React.ReactNode;
}

const ContainerDeploymentStateProvider: React.FC<ContainerDeploymentProviderProps> = ({
    children,
}) => {
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
                completeDockerStep: function (dockerStep: number): void {
                    webviewState?.extensionRpc.action("completeDockerStep", {
                        dockerStep: dockerStep,
                    });
                },
                resetDockerStepState: function (): void {
                    webviewState?.extensionRpc.action("resetDockerStepState", {});
                },
                checkDockerProfile: function (): void {
                    webviewState?.extensionRpc.action("checkDockerProfile", {});
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
        </ContainerDeploymentContext.Provider>
    );
};

export { ContainerDeploymentContext, ContainerDeploymentStateProvider };
