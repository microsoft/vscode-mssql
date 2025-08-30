/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { StepCard } from "./stepCard";
import { Button } from "@fluentui/react-components";
import { LocalContainersInputForm } from "./localContainersInputForm";
import {
    checkStepErrored,
    isLastStepLoaded,
    runDockerStep,
} from "./localContainersDeploymentUtils";
import {
    DockerStepOrder,
    LocalContainersState,
} from "../../../../sharedInterfaces/localContainers";
import { LocalContainersHeader } from "./localContainersHeader";
import { locConstants } from "../../../common/locConstants";
import { stepPageStyles } from "./sharedStyles";
import { DeploymentContext } from "../deploymentStateProvider";

export const LocalContainersPrereqPage: React.FC = () => {
    const classes = stepPageStyles();
    const state = useContext(DeploymentContext);
    const localContainersState = state?.state.deploymentTypeState as LocalContainersState;
    const [showNext, setShowNext] = useState(false);
    const [stepsLoaded, setStepsLoaded] = useState(false);
    const [stepsErrored, setStepsErrored] = useState(false);
    const lastStep = DockerStepOrder.checkDockerEngine;

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!state || !localContainersState) {
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

    return showNext ? (
        <LocalContainersInputForm />
    ) : (
        <div>
            <LocalContainersHeader
                headerText={locConstants.localContainers.sqlServerContainerHeader}
            />
            <div className={classes.outerDiv}>
                <div className={classes.stepsDiv}>
                    <div className={classes.stepsHeader}>
                        {locConstants.localContainers.gettingDockerReady}
                    </div>
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
                    <div className={classes.buttonDiv}>
                        {stepsErrored && (
                            <Button
                                className={classes.button}
                                onClick={handleRetry}
                                appearance="primary">
                                {locConstants.common.retry}
                            </Button>
                        )}
                        {stepsLoaded ? (
                            <Button
                                className={classes.button}
                                onClick={() => setShowNext(true)}
                                appearance="primary">
                                {locConstants.common.next}
                            </Button>
                        ) : (
                            <Button
                                className={classes.button}
                                onClick={() => {
                                    state.dispose();
                                }}>
                                {locConstants.common.cancel}
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
