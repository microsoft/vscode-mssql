/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FormContextProps, FormEvent, FormItemOptions, FormItemSpec, FormState } from "./form";
import {
    LocalContainersContextProps,
    DockerConnectionProfile as LocalContainersFormState,
    LocalContainersReducers,
    LocalContainersWebviewState,
} from "./localContainers";
import { ApiStatus } from "./webview";
import { ConnectionGroupSpec } from "./connectionGroup";
import { IDialogProps } from "./connectionDialog";
import {
    FabricProvisioningContextProps,
    FabricProvisioningFormState,
    FabricProvisioningReducers,
    FabricProvisioningWebviewState,
} from "./fabricProvisioning";

export class DeploymentWebviewState
    implements FormState<DeploymentFormState, DeploymentWebviewState, DeploymentFormItemSpec>
{
    loadState: ApiStatus = ApiStatus.Loading;
    errorMessage?: string;
    deploymentType: DeploymentType = DeploymentType.LocalContainers;
    isDeploymentTypeInitialized: boolean = false;
    dialog: IDialogProps | undefined;
    deploymentTypeState: DeploymentTypeState = {} as DeploymentTypeState;
    formState: DeploymentFormState = {} as DeploymentFormState;
    formComponents: Partial<Record<keyof DeploymentFormState, DeploymentFormItemSpec>> = {};
    formErrors: string[] = [];
    connectionGroupOptions: FormItemOptions[] = [];
}

export interface DeploymentCommonReducers {
    /**
     * Initializes the deployment context with specific deployment type details.
     * @param deploymentType The type of deployment to initialize.
     */
    initializeDeploymentSpecifics: { deploymentType: DeploymentType };

    /**
     * Handles form-related actions and state updates.
     */
    formAction: {
        event: FormEvent<DeploymentFormState>;
    };

    /**
     * Handles the action of creating a connection group.
     */
    createConnectionGroup: {
        connectionGroupSpec: ConnectionGroupSpec;
    };

    /**
     * Handles the action of opening/closing the connection group dialog.
     */
    setConnectionGroupDialogState: { shouldOpen: boolean };

    /**
     * Reducer for cleanup and disposal logic.
     */
    dispose: {};
}

export interface DeploymentCommonContextProps
    extends FormContextProps<DeploymentFormState, DeploymentWebviewState, DeploymentFormItemSpec> {
    /**
     * Initializes the deployment context with specific deployment type details.
     * @param deploymentType The type of deployment to initialize.
     */
    initializeDeploymentSpecifics(deploymentType: DeploymentType): void;

    /**
     * Handles form-related actions and state updates.
     * @param event The form event containing the action and data.
     */
    formAction(event: FormEvent<DeploymentFormState>): void;

    /**
     * Creates a connection group based on the provided spec.
     */
    createConnectionGroup(connectionGroupSpec: ConnectionGroupSpec): void;

    /**
     * Sets the visibility of the connection group dialog based on the provided state.
     * @param shouldOpen - A boolean indicating whether the dialog should be open or closed.
     */
    setConnectionGroupDialogState(shouldOpen: boolean): void;

    /**
     * Cleans up and disposes of resources used by the deployment context.
     */
    dispose(): void;
}

/**
 * Enumeration representing the different deployment types
 */
export enum DeploymentType {
    LocalContainers = 0,
    FabricProvisioning = 1,
    AzureSqlDatabase = 2,
    DevContainer = 3,
}

export interface DeploymentFormItemSpec
    extends FormItemSpec<DeploymentFormState, DeploymentWebviewState, DeploymentFormItemSpec> {
    componentWidth: string;
    isAdvancedOption: boolean;
}

export type DeploymentTypeState = LocalContainersWebviewState | FabricProvisioningWebviewState;

export type DeploymentContextProps = DeploymentCommonContextProps &
    LocalContainersContextProps &
    FabricProvisioningContextProps;

export type DeploymentReducers = DeploymentCommonReducers &
    LocalContainersReducers &
    FabricProvisioningReducers;

export type DeploymentFormState = LocalContainersFormState | FabricProvisioningFormState;
