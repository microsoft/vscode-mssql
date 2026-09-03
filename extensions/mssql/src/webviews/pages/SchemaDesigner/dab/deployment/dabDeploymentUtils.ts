/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../../../../../sharedInterfaces/dab";
import { ApiStatus } from "../../../../../sharedInterfaces/webview";
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
        [Dab.DabDeploymentStepOrder.acquireDabCli]: {
            header: locConstants.schemaDesigner.gettingDabCli,
            body: locConstants.schemaDesigner.downloadingDabCli,
        },
        [Dab.DabDeploymentStepOrder.checkDotnetRuntime]: {
            header: locConstants.schemaDesigner.checkingDotnetRuntime,
            body: locConstants.schemaDesigner.resolvingDotnetRuntime,
        },
        [Dab.DabDeploymentStepOrder.validateCliConfig]: {
            header: locConstants.schemaDesigner.validatingDabConfig,
            body: locConstants.schemaDesigner.checkingGeneratedConfig,
        },
        [Dab.DabDeploymentStepOrder.startCliEngine]: {
            header: locConstants.schemaDesigner.startingDabEngine,
            body: locConstants.schemaDesigner.launchingDabEngine,
        },
        [Dab.DabDeploymentStepOrder.checkCliEngine]: {
            header: locConstants.schemaDesigner.checkingEngineReadiness,
            body: locConstants.schemaDesigner.verifyingApiReady,
        },
    };
}

/**
 * Gets prerequisite step statuses for the target being deployed to
 */
export function getPrereqSteps(
    stepStatuses: Dab.DabDeploymentStepStatus[],
    target: Dab.DabDeploymentTarget = Dab.DabDeploymentTarget.Docker,
): Dab.DabDeploymentStepStatus[] {
    const prerequisites = Dab.dabDeploymentStepsByTarget[target].prerequisites;
    return stepStatuses.filter((s) => prerequisites.includes(s.step));
}

/**
 * Gets deployment step statuses for the target being deployed to
 */
export function getDeploySteps(
    stepStatuses: Dab.DabDeploymentStepStatus[],
    target: Dab.DabDeploymentTarget = Dab.DabDeploymentTarget.Docker,
): Dab.DabDeploymentStepStatus[] {
    const deployment = Dab.dabDeploymentStepsByTarget[target].deployment;
    return stepStatuses.filter((s) => deployment.includes(s.step));
}

/**
 * Checks if all steps in the list are completed
 */
export function areStepsComplete(steps: Dab.DabDeploymentStepStatus[]): boolean {
    return steps.every((s) => s.status === ApiStatus.Loaded);
}

/**
 * Checks if any step in the list has errored
 */
export function hasStepErrored(steps: Dab.DabDeploymentStepStatus[]): boolean {
    return steps.some((s) => s.status === ApiStatus.Error);
}
