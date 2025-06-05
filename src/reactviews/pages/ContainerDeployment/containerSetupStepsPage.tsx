/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { StepCard } from "./stepCard";
import { Button } from "@fluentui/react-components";
import { checkStepsLoaded, runDockerSteps } from "./deploymentUtils";
import { DockerStepOrder } from "../../../sharedInterfaces/containerDeploymentInterfaces";
import { ContainerDeploymentHeader } from "./containerDeploymentHeader";
import { locConstants } from "../../common/locConstants";
import { stepPageStyles } from "./sharedStyles";

export const ContainerSetupStepsPage: React.FC = () => {
    const classes = stepPageStyles();
    const state = useContext(ContainerDeploymentContext);
    const containerDeploymentState = state?.state;
    const [stepsLoaded, setStepsLoaded] = useState(false);

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!containerDeploymentState || !containerDeploymentState.formState.containerName) {
        return undefined;
    }

    useEffect(() => {
        const runDockerSetupSteps = async () => {
            await runDockerSteps(
                state,
                DockerStepOrder.startContainer,
                DockerStepOrder.connectToContainer,
            );
        };
        void runDockerSetupSteps();
    }, [containerDeploymentState]);

    useEffect(() => {
        setStepsLoaded(
            checkStepsLoaded(
                containerDeploymentState.dockerSteps,
                DockerStepOrder.connectToContainer,
            ),
        );
    }, [containerDeploymentState]);

    return (
        <div>
            <ContainerDeploymentHeader
                headerText={containerDeploymentState.formState.containerName}
            />
            <div className={classes.outerDiv}>
                <div className={classes.stepsDiv}>
                    <div className={classes.stepsHeader}>
                        {locConstants.containerDeployment.settingUp}{" "}
                        {containerDeploymentState.formState.containerName}...
                    </div>
                    <div className={classes.stepsSubheader}>
                        {locConstants.containerDeployment.gettingContainerReadyForConnection}
                    </div>
                    <StepCard
                        step={containerDeploymentState.dockerSteps[DockerStepOrder.startContainer]}
                    />
                    <StepCard
                        step={containerDeploymentState.dockerSteps[DockerStepOrder.checkContainer]}
                    />
                    <StepCard
                        step={
                            containerDeploymentState.dockerSteps[DockerStepOrder.connectToContainer]
                        }
                    />
                    <Button
                        className={classes.button}
                        onClick={() => (stepsLoaded ? state.dispose() : undefined)}
                        appearance={stepsLoaded ? "primary" : "secondary"}>
                        {locConstants.common.finish}
                    </Button>
                </div>
            </div>
        </div>
    );
};
