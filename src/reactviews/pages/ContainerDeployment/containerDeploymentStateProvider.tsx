/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cd from "./containerDeploymentInterfaces";

import {
    ColorThemeKind,
    useVscodeWebview,
} from "../../common/vscodeWebviewProvider";
import { ReactNode, createContext } from "react";

export interface ContainerDeploymentState {
    provider: cd.ContainerDeploymentProvider;
    state: cd.ContainerDeploymentWebviewState;
    themeKind: ColorThemeKind;
}

const ContainerDeploymentContext = createContext<
    ContainerDeploymentState | undefined
>(undefined);

interface ContainerDeploymentContextProps {
    children: ReactNode;
}

const ContainerDeploymentStateProvider: React.FC<
    ContainerDeploymentContextProps
> = ({ children }) => {
    const webviewState = useVscodeWebview<
        cd.ContainerDeploymentWebviewState,
        cd.ContainerDeploymentReducers
    >();
    return (
        <ContainerDeploymentContext.Provider
            value={{
                provider: {
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
                        webviewState?.extensionRpc.action(
                            "checkLinuxEngine",
                            {},
                        );
                    },
                },
                state: webviewState?.state as cd.ContainerDeploymentWebviewState,
                themeKind: webviewState?.themeKind,
            }}
        >
            {children}
        </ContainerDeploymentContext.Provider>
    );
};

export { ContainerDeploymentContext, ContainerDeploymentStateProvider };
