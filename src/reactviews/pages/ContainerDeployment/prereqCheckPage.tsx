/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { StepCard } from "./stepCard";
import { Button } from "@fluentui/react-components";
import { ContainerInputForm } from "./containerInputForm";
import { checkStepErrored, isLastStepLoaded, runDockerStep } from "./deploymentUtils";
import { DockerStepOrder } from "../../../sharedInterfaces/containerDeployment";
import { ContainerDeploymentHeader } from "./containerDeploymentHeader";
import { locConstants } from "../../common/locConstants";
import { stepPageStyles } from "./sharedStyles";

export const PrereqCheckPage: React.FC = () => {
    const classes = stepPageStyles();
    const state = useContext(ContainerDeploymentContext);
    const [showNext, setShowNext] = useState(false);
    const [stepsLoaded, setStepsLoaded] = useState(false);
    const [stepsErrored, setStepsErrored] = useState(false);
    const lastStep = DockerStepOrder.checkDockerEngine;

    const containerDeploymentState = state?.state;

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!state || !containerDeploymentState) {
        return undefined;
    }

    useEffect(() => {
        void runDockerStep(state, lastStep);
    }, [containerDeploymentState]);

    useEffect(() => {
        setStepsLoaded(isLastStepLoaded(state, lastStep));
    }, [containerDeploymentState]);

    useEffect(() => {
        setStepsErrored(checkStepErrored(state));
    }, [containerDeploymentState]);

    const handleRetry = async () => {
        // reset step states
        await state.resetDockerStepState();
    };

    return showNext ? (
        <ContainerInputForm />
    ) : (
        <div>
            <ContainerDeploymentHeader
                headerText={locConstants.containerDeployment.sqlServerContainerHeader}
            />
            <div className={classes.outerDiv}>
                <div className={classes.stepsDiv}>
                    <div className={classes.stepsHeader}>
                        {locConstants.containerDeployment.gettingDockerReady}
                    </div>
                    <div className={classes.stepsSubheader}>
                        {locConstants.containerDeployment.checkingPrerequisites}
                    </div>
                    <StepCard
                        step={
                            containerDeploymentState.dockerSteps[DockerStepOrder.dockerInstallation]
                        }
                    />
                    <StepCard
                        step={
                            containerDeploymentState.dockerSteps[DockerStepOrder.startDockerDesktop]
                        }
                    />
                    <StepCard
                        step={
                            containerDeploymentState.dockerSteps[DockerStepOrder.checkDockerEngine]
                        }
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
