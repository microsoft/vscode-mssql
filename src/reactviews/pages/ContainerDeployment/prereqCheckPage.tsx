/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { StepCard } from "./stepCard";
import { Button, makeStyles } from "@fluentui/react-components";
import { ContainerInputForm } from "./containerInputForm";
import { checkStepsLoaded, runDockerSteps } from "./deploymentUtils";
import { DockerStepOrder } from "../../../sharedInterfaces/containerDeploymentInterfaces";
import { ContainerDeploymentHeader } from "./containerDeploymentHeader";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        minWidth: "650px",
        minHeight: "fit-content",
    },
    stepsDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "fit-content",
        width: "500px",
    },
    button: {
        height: "28px",
        width: "60px",
        marginTop: "20px",
    },
    stepsHeader: {
        width: "100%",
        fontSize: "24px",
        padding: "8px",
        alignItems: "unset",
        textAlign: "left",
    },
    stepsSubheader: {
        width: "100%",
        fontSize: "14px",
        alignItems: "unset",
        textAlign: "left",
        padding: "8px",
    },
});

export const PrereqCheckPage: React.FC = () => {
    const classes = useStyles();
    const state = useContext(ContainerDeploymentContext);
    const [showNext, setShowNext] = useState(false);
    const [stepsLoaded, setStepsLoaded] = useState(false);
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
            checkStepsLoaded(
                containerDeploymentState.dockerSteps,
                DockerStepOrder.checkDockerEngine,
            ),
        );
    }, [containerDeploymentState]);

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
    );
};
