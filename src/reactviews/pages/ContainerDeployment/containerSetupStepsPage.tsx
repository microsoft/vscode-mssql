/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { StepCard } from "./stepCard";
import { Button, makeStyles } from "@fluentui/react-components";
import { checkStepsLoaded, runDockerSteps } from "./deploymentUtils";
import { DockerStepOrder } from "../../../sharedInterfaces/containerDeploymentInterfaces";
import { ContainerDeploymentHeader } from "./containerDeploymentHeader";

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
        fontWeight: 500,
    },
    stepsSubheader: {
        width: "100%",
        fontSize: "14px",
        alignItems: "unset",
        textAlign: "left",
        padding: "8px",
    },
});

export const ContainerSetupStepsPage: React.FC = () => {
    const classes = useStyles();
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
                        Setting up {containerDeploymentState.formState.containerName}...
                    </div>
                    <div className={classes.stepsSubheader}>
                        Getting container ready for connections
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
                        Finish
                    </Button>
                </div>
            </div>
        </div>
    );
};
