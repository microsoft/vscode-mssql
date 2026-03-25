/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useMemo } from "react";
import { StepCard } from "./stepCard";
import { runDockerStep } from "./localContainersDeploymentUtils";
import {
    DockerStepOrder,
    LocalContainersState,
} from "../../../../sharedInterfaces/localContainers";
import { DeploymentWebviewState } from "../../../../sharedInterfaces/deployment";
import { locConstants } from "../../../common/locConstants";
import { stepPageStyles } from "./sharedStyles";
import { DeploymentContext } from "../deploymentStateProvider";
import { useLocalContainersDeploymentSelector } from "../deploymentSelector";

export const LocalContainersDeploymentProvisioningPage: React.FC = () => {
    const classes = stepPageStyles();
    const context = useContext(DeploymentContext);
    const dockerSteps = useLocalContainersDeploymentSelector((s) => s.dockerSteps);
    const currentDockerStep = useLocalContainersDeploymentSelector((s) => s.currentDockerStep);
    const containerName = useLocalContainersDeploymentSelector((s) => s.formState?.containerName);
    const lastStep = DockerStepOrder.connectToContainer;

    const localContainersWrappedState = useMemo(
        () =>
            ({
                deploymentTypeState: new LocalContainersState({
                    dockerSteps,
                    currentDockerStep,
                }),
            }) as DeploymentWebviewState,
        [currentDockerStep, dockerSteps],
    );

    if (!context || !containerName) {
        return undefined;
    }

    useEffect(() => {
        void runDockerStep(context, localContainersWrappedState, lastStep);
    }, [context, localContainersWrappedState]);

    return (
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.stepsHeader}>
                    {locConstants.localContainers.settingUp} {containerName}...
                </div>
                <div className={classes.stepsSubheader}>
                    {locConstants.localContainers.gettingContainerReadyForConnection}
                </div>
                <StepCard step={dockerSteps[DockerStepOrder.pullImage]} />
                <StepCard step={dockerSteps[DockerStepOrder.startContainer]} />
                <StepCard step={dockerSteps[DockerStepOrder.checkContainer]} />
                <StepCard step={dockerSteps[DockerStepOrder.connectToContainer]} />
            </div>
        </div>
    );
};
