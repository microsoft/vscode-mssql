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

export const LocalContainersPrereqPage: React.FC = () => {
    const classes = stepPageStyles();
    const context = useContext(DeploymentContext);
    const localContainersState = useDeploymentSelector(
        (s) => s.deploymentTypeState,
    ) as LocalContainersState;
    const lastStep = DockerStepOrder.checkDockerEngine;

    useEffect(() => {
        if (!context || !localContainersState) return;
        const wrappedState = {
            deploymentTypeState: localContainersState,
        } as DeploymentWebviewState;
        void runDockerStep(context, wrappedState, lastStep);
    }, [localContainersState]);

    if (!context || !localContainersState?.dockerSteps) {
        return undefined;
    }

    return (
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.stepsSubheader}>
                    {locConstants.localContainers.checkingPrerequisites}
                </div>
                <StepCard
                    step={localContainersState.dockerSteps[DockerStepOrder.dockerInstallation]}
                />
                <StepCard
                    step={localContainersState.dockerSteps[DockerStepOrder.startDockerDesktop]}
                />
                <StepCard
                    step={localContainersState.dockerSteps[DockerStepOrder.checkDockerEngine]}
                />
            </div>
        </div>
    );
};
