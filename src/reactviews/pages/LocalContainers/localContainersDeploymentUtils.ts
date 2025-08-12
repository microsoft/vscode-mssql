/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeploymentContextProps } from "../../../sharedInterfaces/deployment";
import { ApiStatus } from "../../../sharedInterfaces/webview";

/**
 * Runs a Docker step if the current step is less than or equal to the last step.
 * @param state The context containing the state and methods to complete Docker steps.
 * @param lastStep The index of the last step to check against.
 */
export async function runDockerStep(
    state: DeploymentContextProps,
    lastStep: number,
): Promise<void> {
    const localContainersState = state.state.deploymentTypeState;
    const currentStep = localContainersState.currentDockerStep;
    // If the current step is less than or equal to the last step,
    // complete the step to move to the next one
    if (currentStep <= lastStep) {
        await state.completeDockerStep(currentStep);
    }
}

/**
 * Checks if the last step in the Docker deployment process is loaded.
 * @param state The context containing the state of the Docker deployment.
 * @param lastStep The index of the last step to check.
 * @return {boolean} True if the last step is loaded, false otherwise.
 */
export function isLastStepLoaded(state: DeploymentContextProps, lastStep: number): boolean {
    const localContainersState = state.state.deploymentTypeState;
    return localContainersState.dockerSteps[lastStep].loadState === ApiStatus.Loaded;
}

/**
 * Checks if the current Docker step has errored.
 * @param state The context containing the state of the Docker deployment.
 * @return {boolean} True if the current step has errored, false otherwise.
 */
export function checkStepErrored(state: DeploymentContextProps): boolean {
    const localContainersState = state.state.deploymentTypeState;

    // Safe check to ensure currentDockerStep is within bounds; if not, we've finished all steps
    if (
        localContainersState.currentDockerStep ===
        Object.keys(localContainersState.dockerSteps).length
    )
        return false;
    // Check if the current Docker step has errored
    const currentDockerStep =
        localContainersState.dockerSteps[localContainersState.currentDockerStep];
    return currentDockerStep.loadState === ApiStatus.Error;
}
