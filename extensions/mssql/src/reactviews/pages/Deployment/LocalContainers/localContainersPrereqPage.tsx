/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
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
import { ApiStatus } from "../../../../sharedInterfaces/webview";

const useLoadingStyles = makeStyles({
    spinnerDiv: {
        height: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "20px",
    },
    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
    },
});

export const LocalContainersPrereqPage: React.FC = () => {
    const classes = stepPageStyles();
    const loadingClasses = useLoadingStyles();
    const context = useContext(DeploymentContext);
    const localContainersState = useDeploymentSelector(
        (s) => s.deploymentTypeState,
    ) as LocalContainersState;
    const lastStep = DockerStepOrder.checkDockerEngine;

    if (!context || !localContainersState) {
        return undefined;
    }

    useEffect(() => {
        const wrappedState = {
            deploymentTypeState: localContainersState,
        } as DeploymentWebviewState;
        void runDockerStep(context, wrappedState, lastStep);
    }, [context, localContainersState]);

    if (localContainersState.loadState === ApiStatus.Loading) {
        return (
            <div className={loadingClasses.spinnerDiv}>
                <Spinner
                    label={locConstants.localContainers.loadingLocalContainers}
                    labelPosition="below"
                />
            </div>
        );
    }

    if (localContainersState.loadState === ApiStatus.Error) {
        return (
            <div className={loadingClasses.spinnerDiv}>
                <ErrorCircleRegular className={loadingClasses.errorIcon} />
                <Text size={400}>{localContainersState.errorMessage ?? ""}</Text>
            </div>
        );
    }

    return (
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
            </div>
        </div>
    );
};
