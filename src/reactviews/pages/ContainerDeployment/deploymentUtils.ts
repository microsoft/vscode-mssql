/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ContainerDeploymentContextProps,
    DockerStep,
} from "../../../sharedInterfaces/containerDeploymentInterfaces";
import { ApiStatus } from "../../../sharedInterfaces/webview";

/**
 * Get the index of the first Docker step that has not started loading.
 * @param steps The array of Docker steps.
 * @param startStep The index of the step to start checking from.
 * @param endStep The index of the step to stop checking at.
 * @returns The index of the first not started step, or -1 if all steps are in a different state.
 */
export function getFirstNotStartedStepIndex(
    steps: DockerStep[],
    startStep: number,
    endStep: number,
): number {
    for (let i = startStep; i <= endStep && i < steps.length; i++) {
        if (steps[i].loadState === ApiStatus.NotStarted) {
            return i;
        }
    }
    return -1;
}

/**
 * Completes the current Docker Step
 * @param state The context containing the state and methods to complete Docker steps.
 * @param startStep The index of the first step to potentially complete.
 * @param endStep The index of the last step to potentially complete.
 * @return A promise that resolves when all steps from startStep to endStep have been completed.
 */
export async function runDockerSteps(
    state: ContainerDeploymentContextProps,
    startStep: number,
    endStep: number,
): Promise<void> {
    // find current step
    const currentStep = getFirstNotStartedStepIndex(state.state.dockerSteps, startStep, endStep);
    if (currentStep === -1) {
        return;
    }
    await state.completeDockerStep(currentStep);
}

/**
 * Checks if all Docker steps up to a certain point have been loaded.
 * @param steps The array of Docker steps.
 * @param upToStep The index of the last step to check.
 * @returns True if all steps are loaded, false otherwise.
 */
export function checkStepsLoaded(steps: DockerStep[], upToStep: number): boolean {
    for (let i = 0; i <= upToStep && i < steps.length; i++) {
        if (steps[i].loadState !== ApiStatus.Loaded) {
            return false;
        }
    }
    return true;
}
