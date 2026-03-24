/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
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
import { useDeploymentSelector } from "../deploymentSelector";

export const LocalContainersDeploymentProvisioningPage: React.FC = () => {
    const classes = stepPageStyles();
    const context = useContext(DeploymentContext);
    const localContainersState = useDeploymentSelector(
        (s) => s.deploymentTypeState,
    ) as LocalContainersState;
    const lastStep = DockerStepOrder.connectToContainer;

    if (!context || !localContainersState || !localContainersState.formState.containerName) {
        return undefined;
    }

    useEffect(() => {
        const wrappedState = {
            deploymentTypeState: localContainersState,
        } as DeploymentWebviewState;
        void runDockerStep(context, wrappedState, lastStep);
    }, [context, localContainersState]);

    return (
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.stepsHeader}>
                    {locConstants.localContainers.settingUp}{" "}
                    {localContainersState.formState.containerName}...
                </div>
                <div className={classes.stepsSubheader}>
                    {locConstants.localContainers.gettingContainerReadyForConnection}
                </div>
                <StepCard step={localContainersState.dockerSteps[DockerStepOrder.pullImage]} />
                <StepCard step={localContainersState.dockerSteps[DockerStepOrder.startContainer]} />
                <StepCard step={localContainersState.dockerSteps[DockerStepOrder.checkContainer]} />
                <StepCard
                    step={localContainersState.dockerSteps[DockerStepOrder.connectToContainer]}
                />
            </div>
        </div>
    );
};
