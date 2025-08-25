/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { createContext } from "react";
import {
    DeploymentContextProps,
    DeploymentReducers,
    DeploymentType,
    DeploymentWebviewState,
} from "../../../sharedInterfaces/deployment";
import { getCoreRPCs } from "../../common/utils";
import { ConnectionGroupSpec } from "../../../sharedInterfaces/connectionGroup";

const DeploymentContext = createContext<DeploymentContextProps | undefined>(undefined);

interface DeploymentProviderProps {
    children: React.ReactNode;
}

const DeploymentStateProvider: React.FC<DeploymentProviderProps> = ({ children }) => {
    const webviewState = useVscodeWebview<DeploymentWebviewState, DeploymentReducers>();
    return (
        <DeploymentContext.Provider
            value={{
                // @ts-ignore
                state: webviewState?.state,
                themeKind: webviewState?.themeKind,
                ...getCoreRPCs(webviewState),
                initializeDeploymentSpecifics: function (deploymentType: DeploymentType): void {
                    webviewState?.extensionRpc.action("initializeDeploymentSpecifics", {
                        deploymentType: deploymentType,
                    });
                },
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
        </DeploymentContext.Provider>
    );
};

export { DeploymentContext, DeploymentStateProvider };
