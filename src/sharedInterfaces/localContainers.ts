/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { FormContextProps, FormItemSpec, FormState } from "./form";
import { IConnectionDialogProfile, IDialogProps } from "./connectionDialog";

export class LocalContainersWebviewState
    implements
        FormState<
            DockerConnectionProfile,
            LocalContainersWebviewState,
            LocalContainersFormItemSpec
        >
{
    loadState: ApiStatus = ApiStatus.Loading;
    errorMessage?: string;
    public dockerSteps: DockerStep[] = [];
    // @ts-ignore
    formState: DockerConnectionProfile = undefined;
    formComponents: Partial<Record<keyof DockerConnectionProfile, LocalContainersFormItemSpec>> =
        {};
    formErrors: string[] = [];
    platform: string = "";
    dialog: IDialogProps | undefined;
    /** Used for container name validation within the form */
    isValidContainerName: boolean = false;
    /** Used for port number validation within the form */
    isValidPortNumber: boolean = false;
    /** Used to check whether docker container creation can proceed */
    isDockerProfileValid: boolean = false;
    /** Used to track the form validation state */
    formValidationLoadState: ApiStatus = ApiStatus.NotStarted;
    /** Used to track the current step in the Docker deployment process */
    currentDockerStep: DockerStepOrder = DockerStepOrder.dockerInstallation;
    constructor(params?: Partial<LocalContainersWebviewState>) {
        for (const key in params) {
            if (key in this) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe due to key in this check being a Partial of the class
                (this as any)[key as keyof LocalContainersWebviewState] =
                    params[key as keyof LocalContainersWebviewState]!;
            }
        }
    }
}

export interface DockerConnectionProfile extends IConnectionDialogProfile {
    version: string;
    hostname: string;
    profileName: string;
    savePassword: boolean;
    acceptEula: boolean;
}

export interface LocalContainersFormItemSpec
    extends FormItemSpec<
        DockerConnectionProfile,
        LocalContainersWebviewState,
        LocalContainersFormItemSpec
    > {
    componentWidth: string;
    isAdvancedOption: boolean;
}

export interface LocalContainersContextProps
    extends FormContextProps<
        DockerConnectionProfile,
        LocalContainersWebviewState,
        LocalContainersFormItemSpec
    > {
    /**
     * Checks the selected Docker profile's availability and configuration.
     */
    checkDockerProfile(): void;

    /**
     * Runs the current docker step
     */
    completeDockerStep(dockerStep: number): void;

    /**
     * Resets the states of the current Docker step to NotStarted.
     */
    resetDockerStepState(): void;
}

export interface LocalContainersReducers {
    /**
     * Reducer for completing the current Docker step.
     */
    completeDockerStep: { dockerStep: number };

    /**
     * Reducer for resetting the current Docker step state.
     * Resets the current Docker step to NotStarted.
     */
    resetDockerStepState: {};

    /**
     * Reducer for Docker profile validation.
     */
    checkDockerProfile: {};
}

/**
 * Represents a step in the Docker deployment process.
 * Each step includes metadata about its state, error handling, and the action to perform.
 */
export interface DockerStep {
    loadState: ApiStatus;
    errorMessage?: string;
    fullErrorText?: string;
    errorLink?: string;
    errorLinkText?: string;
    argNames: string[];
    headerText: string;
    bodyText: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stepAction: (...args: any[]) => Promise<DockerCommandParams>;
}

/**
 * Parameters for Docker command execution.
 * Contains the result of the command execution, including success status,
 * optional error messages, port information, and full error text.
 */
export type DockerCommandParams = {
    success: boolean;
    error?: string;
    port?: number;
    fullErrorText?: string;
};

/**
 * Enumeration representing the order of Docker steps in the deployment process.
 */
export enum DockerStepOrder {
    dockerInstallation = 0,
    startDockerDesktop = 1,
    checkDockerEngine = 2,
    pullImage = 3,
    startContainer = 4,
    checkContainer = 5,
    connectToContainer = 6,
}
