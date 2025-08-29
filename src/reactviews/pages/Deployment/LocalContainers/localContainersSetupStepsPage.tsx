/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { StepCard } from "./stepCard";
import { Button } from "@fluentui/react-components";
import {
    checkStepErrored,
    isLastStepLoaded,
    runDockerStep,
} from "./localContainersDeploymentUtils";
import {
    DockerStepOrder,
    LocalContainersWebviewState,
} from "../../../../sharedInterfaces/localContainers";
import { LocalContainersHeader } from "./localContainersHeader";
import { locConstants } from "../../../common/locConstants";
import { stepPageStyles } from "./sharedStyles";
import { DeploymentContext } from "../deploymentStateProvider";

export const LocalContainersSetupStepsPage: React.FC = () => {
    const classes = stepPageStyles();
    const state = useContext(DeploymentContext);
    const localContainersState = state?.state.deploymentTypeState as LocalContainersWebviewState;
    const [stepsLoaded, setStepsLoaded] = useState(false);
    const [stepsErrored, setStepsErrored] = useState(false);
    const lastStep = DockerStepOrder.connectToContainer;

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!state || !localContainersState || !localContainersState.formState.containerName) {
        return undefined;
    }

    useEffect(() => {
        void runDockerStep(state, lastStep);
    }, [state.state]);

    useEffect(() => {
        setStepsLoaded(isLastStepLoaded(state, lastStep));
    }, [state.state]);

    useEffect(() => {
        setStepsErrored(checkStepErrored(state));
    }, [state.state]);

    const handleRetry = async () => {
        // reset step states
        await state.resetDockerStepState();
    };

    return (
        <div>
            <LocalContainersHeader headerText={localContainersState.formState.containerName} />
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
                    <StepCard
                        step={localContainersState.dockerSteps[DockerStepOrder.startContainer]}
                    />
                    <StepCard
                        step={localContainersState.dockerSteps[DockerStepOrder.checkContainer]}
                    />
                    <StepCard
                        step={localContainersState.dockerSteps[DockerStepOrder.connectToContainer]}
                    />
                    {(stepsErrored || stepsLoaded) && (
                        <div className={classes.buttonDiv}>
                            {stepsErrored && (
                                <Button
                                    className={classes.button}
                                    onClick={handleRetry}
                                    appearance="primary">
                                    {locConstants.common.retry}
                                </Button>
                            )}
                            <Button
                                className={classes.button}
                                onClick={() => state.dispose()}
                                appearance={stepsLoaded ? "primary" : "secondary"}>
                                {stepsLoaded
                                    ? locConstants.common.finish
                                    : locConstants.common.cancel}
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
