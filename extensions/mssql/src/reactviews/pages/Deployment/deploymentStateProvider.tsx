/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { createContext, useMemo } from "react";
import {
    DeploymentContextProps,
    DeploymentFormState,
    DeploymentReducers,
    DeploymentType,
    DeploymentWebviewState,
} from "../../../sharedInterfaces/deployment";
import { getCoreRPCs } from "../../common/utils";
import { ConnectionGroupSpec } from "../../../sharedInterfaces/connectionGroup";
import { FormEvent } from "../../../sharedInterfaces/form";

const DeploymentContext = createContext<DeploymentContextProps | undefined>(undefined);

interface DeploymentProviderProps {
    children: React.ReactNode;
}

const DeploymentStateProvider: React.FC<DeploymentProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview<DeploymentWebviewState, DeploymentReducers>();

    const commands = useMemo<DeploymentContextProps>(
        () => ({
            ...getCoreRPCs(extensionRpc),
            //#region Common Reducers
            initializeDeploymentSpecifics: function (deploymentType: DeploymentType): void {
                extensionRpc.action("initializeDeploymentSpecifics", {
                    deploymentType: deploymentType,
                });
            },
            formAction: function (event): void {
                extensionRpc.action("formAction", {
                    event: event as FormEvent<DeploymentFormState>,
                });
            },
            setConnectionGroupDialogState: function (shouldOpen: boolean): void {
                extensionRpc.action("setConnectionGroupDialogState", {
                    shouldOpen: shouldOpen,
                });
            },
            createConnectionGroup: function (connectionGroupSpec: ConnectionGroupSpec): void {
                extensionRpc.action("createConnectionGroup", {
                    connectionGroupSpec: connectionGroupSpec,
                });
            },
            dispose: function (): void {
                extensionRpc.action("dispose", {});
            },
            //#endregion
            //#region Local Containers Reducers
            completeDockerStep: function (dockerStep: number): void {
                extensionRpc.action("completeDockerStep", {
                    dockerStep: dockerStep,
                });
            },
            resetDockerStepState: function (): void {
                extensionRpc.action("resetDockerStepState", {});
            },
            checkDockerProfile: function (): void {
                extensionRpc.action("checkDockerProfile", {});
            },
            closeArmSql2025ErrorDialog: function (): void {
                extensionRpc.action("closeArmSql2025ErrorDialog", {});
            },
            //#endregion
            //#region Fabric Provisioning Reducers
            reloadFabricEnvironment: function (newTenant?: string): void {
                extensionRpc.action("reloadFabricEnvironment", {
                    newTenant: newTenant,
                });
            },
            handleWorkspaceFormAction: function (workspaceId: string): void {
                extensionRpc.action("handleWorkspaceFormAction", {
                    workspaceId: workspaceId,
                });
            },
            createDatabase: function (): void {
                extensionRpc.action("createDatabase", {});
            },
            retryCreateDatabase: function (): void {
                extensionRpc.action("retryCreateDatabase", {});
            },
            resetFormValidationState: function (): void {
                extensionRpc.action("resetFormValidationState", {});
            },
            //#endregion
        }),
        [extensionRpc],
    );

    return <DeploymentContext.Provider value={commands}>{children}</DeploymentContext.Provider>;
};

export { DeploymentContext, DeploymentStateProvider };
