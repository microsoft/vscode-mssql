/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { StepCard } from "./stepCard";
import { Button } from "@fluentui/react-components";
import { ContainerInputForm } from "./containerInputForm";
import { runDockerSteps } from "./deploymentUtils";
import { DockerStepOrder } from "../../../sharedInterfaces/containerDeploymentInterfaces";
import { ContainerDeploymentHeader } from "./containerDeploymentHeader";
import { locConstants } from "../../common/locConstants";
import { stepPageStyles } from "./sharedStyles";
import { ApiStatus } from "../../../sharedInterfaces/webview";

export const PrereqCheckPage: React.FC = () => {
    const classes = stepPageStyles();
    const state = useContext(ContainerDeploymentContext);
    const [showNext, setShowNext] = useState(false);
    const [stepsLoaded, setStepsLoaded] = useState(false);
    const [stepsErrored, setStepsErrored] = useState(false);

    const containerDeploymentState = state?.state;

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!state || !containerDeploymentState) {
        return undefined;
    }

    useEffect(() => {
        const runDockerSetupSteps = async () => {
            await runDockerSteps(
                state,
                DockerStepOrder.dockerInstallation,
                DockerStepOrder.checkDockerEngine,
            );
        };
        void runDockerSetupSteps();
    }, [containerDeploymentState]);

    useEffect(() => {
        setStepsLoaded(
            containerDeploymentState.dockerSteps[DockerStepOrder.checkDockerEngine].loadState ===
                ApiStatus.Loaded,
        );
    }, [containerDeploymentState]);

    useEffect(() => {
        setStepsErrored(
            containerDeploymentState.dockerSteps[DockerStepOrder.connectToContainer].loadState ===
                ApiStatus.Error,
        );
    }, [containerDeploymentState]);

    const handleRetry = async () => {
        // reset step states
        await state.resetDockerStepStates();
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
