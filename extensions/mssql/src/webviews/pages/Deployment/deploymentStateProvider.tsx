/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { createContext, useCallback, useMemo } from "react";
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

    const formAction = useCallback(
        (event: FormEvent<DeploymentFormState>) => {
            extensionRpc.action("formAction", { event });
        },
        [extensionRpc],
    );

    const commands = useMemo<DeploymentContextProps>(
        () => ({
            ...getCoreRPCs(extensionRpc),
            //#region Common Reducers
            initializeDeploymentSpecifics: function (deploymentType: DeploymentType): void {
                extensionRpc.action("initializeDeploymentSpecifics", {
                    deploymentType: deploymentType,
                });
            },
            formAction: formAction as DeploymentContextProps["formAction"],
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
            //#region Azure SQL Database Reducers
            loadAzureComponent: function (componentName: string): void {
                extensionRpc.action("loadAzureComponent", {
                    componentName: componentName,
                });
            },
            startAzureSqlDatabaseDeployment: function (tags: Record<string, string>): void {
                extensionRpc.action("startAzureSqlDatabaseDeployment", { tags });
            },
            setCreateResourceGroupDrawerState: function (shouldOpen: boolean): void {
                extensionRpc.action("setCreateResourceGroupDrawerState", {
                    shouldOpen: shouldOpen,
                });
            },
            submitCreateResourceGroup: function (spec): void {
                extensionRpc.action("submitCreateResourceGroup", {
                    spec: spec,
                });
            },
            setCreateServerDrawerState: function (shouldOpen: boolean): void {
                extensionRpc.action("setCreateServerDrawerState", {
                    shouldOpen: shouldOpen,
                });
            },
            submitCreateServer: function (spec): void {
                extensionRpc.action("submitCreateServer", {
                    spec: spec,
                });
            },
            //#endregion
        }),
        [extensionRpc, formAction],
    );

    return <DeploymentContext.Provider value={commands}>{children}</DeploymentContext.Provider>;
};

export { DeploymentContext, DeploymentStateProvider };
