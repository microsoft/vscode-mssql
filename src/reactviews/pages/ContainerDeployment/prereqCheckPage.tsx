/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { StepCard } from "./stepCard";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { Button, makeStyles } from "@fluentui/react-components";
import { ContainerInputForm } from "./containerInputForm";

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
        const checkAndStartDocker = async () => {
            if (
                containerDeploymentState!.dockerInstallStatus.loadState ===
                ApiStatus.Loading
            ) {
                await state.checkDockerInstallation();
            }

            if (
                containerDeploymentState!.dockerInstallStatus.loadState ===
                    ApiStatus.Loaded &&
                containerDeploymentState!.dockerStatus.loadState ===
                    ApiStatus.Loading
            ) {
                await state.startDocker();
            }

            if (
                containerDeploymentState?.dockerInstallStatus.loadState ===
                    ApiStatus.Loaded &&
                containerDeploymentState?.dockerStatus.loadState ===
                    ApiStatus.Loaded &&
                containerDeploymentState?.dockerEngineStatus.loadState ===
                    ApiStatus.Loading
            ) {
                await state?.checkEngine();
            }
        };
        void checkAndStartDocker();
    }, [containerDeploymentState]);

    useEffect(() => {
        setStepsLoaded(
            containerDeploymentState!.dockerInstallStatus.loadState ===
                ApiStatus.Loaded &&
                containerDeploymentState!.dockerStatus.loadState ===
                    ApiStatus.Loaded &&
                containerDeploymentState!.dockerEngineStatus.loadState ===
                    ApiStatus.Loaded,
        );
    }, [containerDeploymentState]);

    return showNext ? (
        <ContainerInputForm />
    ) : (
        <div className={classes.outerDiv}>
            <div className={classes.stepsDiv}>
                <div className={classes.stepsHeader}>
                    Getting Docker Ready...
                </div>
                <div className={classes.stepsSubheader}>
                    Checking pre-requisites
                </div>
                <StepCard stepName="dockerInstallStatus" />
                <StepCard stepName="dockerStatus" />
                {containerDeploymentState?.platform !== "linux" && (
                    <StepCard stepName="dockerEngineStatus" />
                )}
                {stepsLoaded ? (
                    <Button
                        className={classes.button}
                        onClick={() => setShowNext(true)}
                        appearance="primary"
                    >
                        Next
                    </Button>
                ) : (
                    <Button
                        className={classes.button}
                        onClick={() => {
                            state.dispose();
                        }}
                    >
                        Cancel
                    </Button>
                )}
            </div>
        </div>
    );
};
