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
    public dockerInstallStatus: DockerStep = {
        loadState: ApiStatus.Loading,
    };
    public dockerStatus: DockerStep = {
        loadState: ApiStatus.Loading,
    };
    public dockerEngineStatus: DockerStep = {
        loadState: ApiStatus.Loading,
    };
    public dockerContainerCreationStatus: DockerStep = {
        loadState: ApiStatus.Loading,
    };
    public dockerContainerStatus: DockerStep = {
        loadState: ApiStatus.Loading,
    };
    public dockerConnectionStatus: DockerStep = {
        loadState: ApiStatus.Loading,
    };
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

export interface DockerStep {
    loadState: ApiStatus;
    errorMessage?: string;
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
     * Checks if Docker is installed on the system.
     */
    checkDockerInstallation(): void;

    /**
     * Starts the Docker daemon if it's not already running.
     */
    startDocker(): void;

    /**
     * Verifies the Docker engine's status and configuration.
     */
    checkEngine(): void;

    /**
     * Checks the selected Docker profile's availability and configuration.
     */
    checkDockerProfile(): void;

    /**
     * Starts the specified container using the current configuration.
     */
    startContainer(): void;

    /**
     * Checks the running status and health of the deployed container.
     */
    checkContainer(): void;

    /**
     * Connects to the running container for interaction or inspection.
     */
    connectToContainer(): void;

    /**
     * Cleans up and disposes of resources used by the deployment context.
     */
    dispose(): void;
}

export interface ContainerDeploymentReducers {
    /**
     * Reducer for Docker installation check results.
     */
    checkDockerInstallation: {};

    /**
     * Reducer for Docker daemon start operation.
     */
    startDocker: {};

    /**
     * Reducer for engine verification process.
     */
    checkEngine: {};

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
     * Reducer for container start operation.
     */
    startContainer: {};

    /**
     * Reducer for container status check.
     */
    checkContainer: {};

    /**
     * Reducer for container connection logic.
     */
    connectToContainer: {};

    /**
     * Reducer for cleanup and disposal logic.
     */
    dispose: {};
}
