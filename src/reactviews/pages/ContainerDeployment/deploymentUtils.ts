/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ContainerDeploymentContextProps,
    DockerStep,
} from "../../../sharedInterfaces/containerDeploymentInterfaces";
import { ApiStatus } from "../../../sharedInterfaces/webview";

export function getFirstLoadingStepIndex(
    steps: DockerStep[],
    startStep: number,
    endStep: number,
): number {
    for (let i = startStep; i <= endStep && i < steps.length; i++) {
        if (steps[i].loadState === ApiStatus.Loading) {
            return i;
        }
    }
    return -1;
}

export async function runDockerSteps(
    state: ContainerDeploymentContextProps,
    startStep: number,
    endStep: number,
): Promise<void> {
    // find current step
    const currentStep = getFirstLoadingStepIndex(state.state.dockerSteps, startStep, endStep);
    if (currentStep === -1) {
        return;
    }
    await state.completeDockerStep(currentStep);
}

export function checkStepsLoaded(steps: DockerStep[], upToStep: number): boolean {
    for (let i = 0; i <= upToStep && i < steps.length; i++) {
        if (steps[i].loadState !== ApiStatus.Loaded) {
            return false;
        }
    }
    return true;
}
