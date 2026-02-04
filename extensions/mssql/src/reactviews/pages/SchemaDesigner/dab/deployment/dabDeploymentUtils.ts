/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../../../../../sharedInterfaces/dab";
import { locConstants } from "../../../../common/locConstants";

/**
 * Gets step labels for DAB deployment display
 */
export function getDabStepLabels(): Record<
    Dab.DabDeploymentStepOrder,
    { header: string; body: string }
> {
    return {
        [Dab.DabDeploymentStepOrder.dockerInstallation]: {
            header: locConstants.schemaDesigner.checkingDockerInstallation,
            body: locConstants.schemaDesigner.verifyingDockerInstalled,
        },
        [Dab.DabDeploymentStepOrder.startDockerDesktop]: {
            header: locConstants.schemaDesigner.startingDockerDesktop,
            body: locConstants.schemaDesigner.ensuringDockerDesktopRunning,
        },
        [Dab.DabDeploymentStepOrder.checkDockerEngine]: {
            header: locConstants.schemaDesigner.checkingDockerEngine,
            body: locConstants.schemaDesigner.verifyingDockerEngineReady,
        },
        [Dab.DabDeploymentStepOrder.pullImage]: {
            header: locConstants.schemaDesigner.pullingDabImage,
            body: locConstants.schemaDesigner.downloadingDabImage,
        },
        [Dab.DabDeploymentStepOrder.startContainer]: {
            header: locConstants.schemaDesigner.startingDabContainer,
            body: locConstants.schemaDesigner.creatingAndStartingContainer,
        },
        [Dab.DabDeploymentStepOrder.checkContainer]: {
            header: locConstants.schemaDesigner.checkingContainerReadiness,
            body: locConstants.schemaDesigner.verifyingApiReady,
        },
    };
}

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
