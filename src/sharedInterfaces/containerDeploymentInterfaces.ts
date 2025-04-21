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

export interface ContainerDeploymentContextProps
    extends FormContextProps<
        DockerConnectionProfile,
        ContainerDeploymentWebviewState,
        ContainerDeploymentFormItemSpec
    > {
    /**
     * Gets the execution plan graph from the provider
     */
    checkDockerInstallation(): void;
    /**
     * Gets the execution plan graph from the provider
     */
    startDocker(): void;
    /**
     * Gets the execution plan graph from the provider
     */
    checkEngine(): void;
    /**
     * Gets the execution plan graph from the provider
     */
    checkDockerProfile(): void;
    /**
     * Gets the execution plan graph from the provider
     */
    startContainer(): void;
    /**
     * Gets the execution plan graph from the provider
     */
    checkContainer(): void;
    /**
     * Gets the execution plan graph from the provider
     */
    connectToContainer(): void;
    /**
     * Gets the execution plan graph from the provider
     */
    dispose(): void;
}

export interface ContainerDeploymentReducers {
    /**
     * Gets the execution plan graph from the provider
     */
    checkDockerInstallation: {};

    /**
     * Gets the execution plan graph from the provider
     */
    startDocker: {};

    /**
     * Gets the execution plan graph from the provider
     */
    checkEngine: {};

    /**
     * Gets the execution plan graph from the provider
     */
    checkDockerProfile: {};

    formAction: {
        event: FormEvent<DockerConnectionProfile>;
    };

    /**
     * Gets the execution plan graph from the provider
     */
    startContainer: {};
    /**
     * Gets the execution plan graph from the provider
     */
    checkContainer: {};
    /**
     * Gets the execution plan graph from the provider
     */
    connectToContainer: {};
    /**
     * Gets the execution plan graph from the provider
     */
    dispose: {};
}
