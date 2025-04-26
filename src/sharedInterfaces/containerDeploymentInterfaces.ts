/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";
import { ApiStatus } from "./webview";
import { FormContextProps, FormEvent, FormItemSpec, FormState } from "./form";

export class ContainerDeploymentWebviewState
    implements
        FormState<
            DockerConnectionProfile,
            ContainerDeploymentWebviewState,
            ContainerDeploymentFormItemSpec
        >
{
    loadState: ApiStatus = ApiStatus.Loading;
    errorMessage?: string;
    public dockerSteps: DockerStep[] = [];
    // @ts-ignore
    formState: DockerConnectionProfile = undefined;
    formComponents: Partial<
        Record<keyof DockerConnectionProfile, ContainerDeploymentFormItemSpec>
    > = {};
    formErrors: string[] = [];
    platform: string = "";
    // Used for container name validation within the form
    isValidContainerName: boolean = false;
    // Used for port number validation within the form
    isValidPortNumber: boolean = false;
    // Used to check whether docker container creation can proceed
    isDockerProfileValid: boolean = false;
    constructor(params?: Partial<ContainerDeploymentWebviewState>) {
        for (const key in params) {
            if (key in this) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe due to key in this check being a Partial of the class
                (this as any)[key as keyof ContainerDeploymentWebviewState] =
                    params[key as keyof ContainerDeploymentWebviewState]!;
            }
        }
    }
}

export interface DockerConnectionProfile extends vscodeMssql.IConnectionInfo {
    containerLoadState: ApiStatus.Loading;
    version: string;
    hostname: string;
    profileName: string;
    savePassword: boolean;
    acceptEula: boolean;
}

export interface ContainerDeploymentFormItemSpec
    extends FormItemSpec<
        DockerConnectionProfile,
        ContainerDeploymentWebviewState,
        ContainerDeploymentFormItemSpec
    > {
    componentWidth: string;
    isAdvancedOption: boolean;
}

export interface ContainerDeploymentFormItemSpec
    extends FormItemSpec<
        DockerConnectionProfile,
        ContainerDeploymentWebviewState,
        ContainerDeploymentFormItemSpec
    > {
    componentWidth: string;
    isAdvancedOption: boolean;
}

export interface ContainerDeploymentContextProps
    extends FormContextProps<
        DockerConnectionProfile,
        ContainerDeploymentWebviewState,
        ContainerDeploymentFormItemSpec
    > {
    /**
     * Checks the selected Docker profile's availability and configuration.
     */
    checkDockerProfile(): void;

    /**
     * Runs a docker step
     */
    completeDockerStep(dockerStepNumber: DockerStepOrder): void;

    /**
     * Cleans up and disposes of resources used by the deployment context.
     */
    dispose(): void;
}

export interface ContainerDeploymentReducers {
    /**
     * Reducer for Docker installation check results.
     */
    completeDockerStep: {
        dockerStepNumber: DockerStepOrder;
    };

    /**
     * Reducer for Docker profile validation.
     */
    checkDockerProfile: {};

    /**
     * Handles form-related actions and state updates.
     */
    formAction: {
        event: FormEvent<DockerConnectionProfile>;
    };

    /**
     * Reducer for cleanup and disposal logic.
     */
    dispose: {};
}

export interface DockerStep {
    loadState: ApiStatus;
    errorMessage?: string;
    argNames: string[];
    headerText: string;
    bodyText: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stepAction: (...args: any[]) => Promise<DockerCommandParams>;
}

export type DockerCommandParams = {
    success: boolean;
    error?: string;
    port?: number;
};

export enum DockerStepOrder {
    dockerInstallation = 0,
    startDockerDesktop = 1,
    checkDockerEngine = 2,
    startContainer = 3,
    checkContainer = 4,
    connectToContainer = 5,
}
