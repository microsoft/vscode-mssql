/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cd from "../../../sharedInterfaces/localContainers";

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { createContext } from "react";
import { LocalContainersContextProps } from "../../../sharedInterfaces/localContainers";
import { getCoreRPCs } from "../../common/utils";
import { ConnectionGroupSpec } from "../../../sharedInterfaces/connectionGroup";

const LocalContainersContext = createContext<LocalContainersContextProps | undefined>(undefined);

interface LocalContainersProviderProps {
    children: React.ReactNode;
}

const LocalContainersStateProvider: React.FC<LocalContainersProviderProps> = ({ children }) => {
    const webviewState = useVscodeWebview<
        cd.LocalContainersWebviewState,
        cd.LocalContainersReducers
    >();
    return (
        <LocalContainersContext.Provider
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
        </LocalContainersContext.Provider>
    );
};

export { LocalContainersContext, LocalContainersStateProvider };
