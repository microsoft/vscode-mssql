/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { StepCard } from "./stepCard";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { Button, makeStyles } from "@fluentui/react-components";

const useStyles = makeStyles({
    outerDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
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

export const ContainerSetupStepsPage: React.FC = () => {
    const classes = useStyles();
    const state = useContext(ContainerDeploymentContext);
    const containerDeploymentState = state?.state;
    const [stepsLoaded, setStepsLoaded] = useState(false);

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!containerDeploymentState) {
        return undefined;
    }

    useEffect(() => {
        const setupContainer = async () => {
            if (
                containerDeploymentState!.dockerContainerCreationStatus
                    .loadState === ApiStatus.Loading
            ) {
                await state.startContainer();
            }

            if (
                containerDeploymentState!.dockerContainerCreationStatus
                    .loadState === ApiStatus.Loaded &&
                containerDeploymentState!.dockerContainerStatus.loadState ===
                    ApiStatus.Loading
            ) {
                await state.checkContainer();
            }

            if (
                containerDeploymentState!.dockerContainerCreationStatus
                    .loadState === ApiStatus.Loaded &&
                containerDeploymentState!.dockerContainerStatus.loadState ===
                    ApiStatus.Loaded &&
                containerDeploymentState!.dockerConnectionStatus.loadState ===
                    ApiStatus.Loading
            ) {
                await state?.connectToContainer();
            }
        };
        void setupContainer();
    }, [containerDeploymentState]);

    useEffect(() => {
        setStepsLoaded(
            containerDeploymentState!.dockerContainerCreationStatus
                .loadState === ApiStatus.Loaded &&
                containerDeploymentState!.dockerContainerStatus.loadState ===
                    ApiStatus.Loaded &&
                containerDeploymentState!.dockerConnectionStatus.loadState ===
                    ApiStatus.Loaded,
        );
    }, [containerDeploymentState]);

    return (
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.stepsHeader}>
                    Setting up container...
                </div>
                <div className={classes.stepsSubheader}>
                    Getting container ready for connections
                </div>
                <StepCard stepName="dockerContainerCreationStatus" />
                <StepCard stepName="dockerContainerStatus" />
                <StepCard stepName="dockerConnectionStatus" />
                <Button
                    className={classes.button}
                    onClick={() => (stepsLoaded ? state.dispose() : undefined)}
                    appearance={stepsLoaded ? "primary" : "secondary"}
                >
                    Finish
                </Button>
            </div>
        </div>
    );
};
