/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "../../../sharedInterfaces/webview";

export interface ContainerDeploymentWebviewState {
    containerDeploymentState: ContainerDeploymentState;
}

export interface ContainerDeploymentState {
    loadState?: ApiStatus;
    errorMessage?: string;
    containerName: string;
    password: string;
    version: string;
    port: number;
}

export interface ContainerDeploymentReducers {
    /**
     * Gets the execution plan graph from the provider
     */
    startDocker: {};
}

export interface ContainerDeploymentProvider {
    /**
     * Gets the execution plan graph from the provider
     */
    startDocker(): void;
}
