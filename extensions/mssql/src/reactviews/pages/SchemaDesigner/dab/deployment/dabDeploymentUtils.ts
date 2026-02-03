/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../../../../../sharedInterfaces/dab";

/**
 * Step labels for DAB deployment display
 */
export const dabStepLabels: Record<Dab.DabDeploymentStepOrder, { header: string; body: string }> = {
    [Dab.DabDeploymentStepOrder.dockerInstallation]: {
        header: "Checking Docker installation",
        body: "Verifying Docker is installed on your system",
    },
    [Dab.DabDeploymentStepOrder.startDockerDesktop]: {
        header: "Starting Docker Desktop",
        body: "Ensuring Docker Desktop is running",
    },
    [Dab.DabDeploymentStepOrder.checkDockerEngine]: {
        header: "Checking Docker engine",
        body: "Verifying Docker engine is ready",
    },
    [Dab.DabDeploymentStepOrder.pullImage]: {
        header: "Pulling DAB container image",
        body: "Downloading the Data API Builder container image",
    },
    [Dab.DabDeploymentStepOrder.startContainer]: {
        header: "Starting DAB container",
        body: "Creating and starting the container",
    },
    [Dab.DabDeploymentStepOrder.checkContainer]: {
        header: "Checking container readiness",
        body: "Verifying the API is ready to accept requests",
    },
};

/**
 * Gets prerequisite step statuses from deployment state
 */
export function getPrereqSteps(
    stepStatuses: Dab.DabDeploymentStepStatus[],
): Dab.DabDeploymentStepStatus[] {
    return stepStatuses.filter(
        (s) =>
            s.step === Dab.DabDeploymentStepOrder.dockerInstallation ||
            s.step === Dab.DabDeploymentStepOrder.startDockerDesktop ||
            s.step === Dab.DabDeploymentStepOrder.checkDockerEngine,
    );
}

/**
 * Gets deployment step statuses from deployment state
 */
export function getDeploySteps(
    stepStatuses: Dab.DabDeploymentStepStatus[],
): Dab.DabDeploymentStepStatus[] {
    return stepStatuses.filter(
        (s) =>
            s.step === Dab.DabDeploymentStepOrder.pullImage ||
            s.step === Dab.DabDeploymentStepOrder.startContainer ||
            s.step === Dab.DabDeploymentStepOrder.checkContainer,
    );
}

/**
 * Checks if all steps in the list are completed
 */
export function areStepsComplete(steps: Dab.DabDeploymentStepStatus[]): boolean {
    return steps.every((s) => s.status === "completed");
}

/**
 * Checks if any step in the list has errored
 */
export function hasStepErrored(steps: Dab.DabDeploymentStepStatus[]): boolean {
    return steps.some((s) => s.status === "error");
}
