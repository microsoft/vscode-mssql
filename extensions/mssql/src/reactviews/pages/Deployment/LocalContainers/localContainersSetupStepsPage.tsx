/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { StepCard } from "./stepCard";
import { Button } from "@fluentui/react-components";
import { checkStepErrored, runDockerStep } from "./localContainersDeploymentUtils";
import {
    DockerStepOrder,
    LocalContainersState,
} from "../../../../sharedInterfaces/localContainers";
import { DeploymentWebviewState } from "../../../../sharedInterfaces/deployment";
import { locConstants } from "../../../common/locConstants";
import { stepPageStyles } from "./sharedStyles";
import { DeploymentContext } from "../deploymentStateProvider";
import { useDeploymentSelector } from "../deploymentSelector";

export const LocalContainersSetupStepsPage: React.FC = () => {
    const classes = stepPageStyles();
    const context = useContext(DeploymentContext);
    const localContainersState = useDeploymentSelector(
        (s) => s.deploymentTypeState,
    ) as LocalContainersState;
    const lastStep = DockerStepOrder.connectToContainer;

    useEffect(() => {
        if (!context || !localContainersState) return;
        const wrappedState = {
            deploymentTypeState: localContainersState,
        } as DeploymentWebviewState;
        void runDockerStep(context, wrappedState, lastStep);
    }, [localContainersState]);

    if (!context || !localContainersState || !localContainersState.formState.containerName) {
        return undefined;
    }

    const handleRetry = async () => {
        await context.resetDockerStepState();
    };

    const stepsErrored = (() => {
        const wrappedState = {
            deploymentTypeState: localContainersState,
        } as DeploymentWebviewState;
        return checkStepErrored(wrappedState);
    })();

    return (
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.stepsSubheader}>
                    {locConstants.localContainers.gettingContainerReadyForConnection}
                </div>
                <StepCard step={localContainersState.dockerSteps[DockerStepOrder.pullImage]} />
                <StepCard step={localContainersState.dockerSteps[DockerStepOrder.startContainer]} />
                <StepCard step={localContainersState.dockerSteps[DockerStepOrder.checkContainer]} />
                <StepCard
                    step={localContainersState.dockerSteps[DockerStepOrder.connectToContainer]}
                />
                {stepsErrored && (
                    <div className={classes.buttonDiv}>
                        <Button
                            className={classes.button}
                            onClick={handleRetry}
                            appearance="primary">
                            {locConstants.common.retry}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};
