/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerDeploymentContextProps } from "../../../shared/containerDeploymentInterfaces";
import { ApiStatus } from "../../../shared/webview";

/**
 * Runs a Docker step if the current step is less than or equal to the last step.
 * @param state The context containing the state and methods to complete Docker steps.
 * @param lastStep The index of the last step to check against.
 */
export async function runDockerStep(
    state: ContainerDeploymentContextProps,
    lastStep: number,
): Promise<void> {
    const currentStep = state.state.currentDockerStep;
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
export function isLastStepLoaded(
    state: ContainerDeploymentContextProps,
    lastStep: number,
): boolean {
    return state.state.dockerSteps[lastStep].loadState === ApiStatus.Loaded;
}

/**
 * Checks if the current Docker step has errored.
 * @param state The context containing the state of the Docker deployment.
 * @return {boolean} True if the current step has errored, false otherwise.
 */
export function checkStepErrored(state: ContainerDeploymentContextProps): boolean {
    // Safe check to ensure currentDockerStep is within bounds; if not, we've finished all steps
    if (state.state.currentDockerStep === state.state.dockerSteps.length) return false;
    // Check if the current Docker step has errored
    const currentDockerStep = state.state.dockerSteps[state.state.currentDockerStep];
    return currentDockerStep.loadState === ApiStatus.Error;
}
