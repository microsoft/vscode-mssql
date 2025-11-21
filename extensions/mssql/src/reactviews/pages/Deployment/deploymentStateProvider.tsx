/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { createContext } from "react";
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

const DeploymentContext = createContext<DeploymentContextProps | undefined>(
  undefined,
);

interface DeploymentProviderProps {
  children: React.ReactNode;
}

const DeploymentStateProvider: React.FC<DeploymentProviderProps> = ({
  children,
}) => {
  const webviewState = useVscodeWebview<
    DeploymentWebviewState,
    DeploymentReducers
  >();
  return (
    <DeploymentContext.Provider
      value={{
        state: webviewState?.state as any,
        themeKind: webviewState?.themeKind,
        keyBindings: webviewState?.keyBindings,
        ...getCoreRPCs(webviewState),
        //#region Common Reducers
        initializeDeploymentSpecifics: function (
          deploymentType: DeploymentType,
        ): void {
          webviewState?.extensionRpc.action("initializeDeploymentSpecifics", {
            deploymentType: deploymentType,
          });
        },
        formAction: function (event): void {
          webviewState?.extensionRpc.action("formAction", {
            event: event as FormEvent<DeploymentFormState>,
          });
        },
        setConnectionGroupDialogState: function (shouldOpen: boolean): void {
          webviewState?.extensionRpc.action("setConnectionGroupDialogState", {
            shouldOpen: shouldOpen,
          });
        },
        createConnectionGroup: function (
          connectionGroupSpec: ConnectionGroupSpec,
        ): void {
          webviewState?.extensionRpc.action("createConnectionGroup", {
            connectionGroupSpec: connectionGroupSpec,
          });
        },
        dispose: function (): void {
          webviewState?.extensionRpc.action("dispose", {});
        },
        //#endregion
        //#region Local Containers Reducers
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
        closeArmSql2025ErrorDialog: function (): void {
          webviewState?.extensionRpc.action("closeArmSql2025ErrorDialog", {});
        },
        //#endregion
        //#region Fabric Provisioning Reducers
        reloadFabricEnvironment: function (newTenant?: string): void {
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
        retryCreateDatabase: function (): void {
          webviewState?.extensionRpc.action("retryCreateDatabase", {});
        },
        resetFormValidationState: function (): void {
          webviewState?.extensionRpc.action("resetFormValidationState", {});
        },
        //#endregion
      }}
    >
      {children}
    </DeploymentContext.Provider>
  );
};

export { DeploymentContext, DeploymentStateProvider };
