/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Spinner,
    Card,
    Button,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    Checkmark20Regular,
    ChevronUp20Regular,
    ChevronLeft20Regular,
    Dismiss20Regular,
} from "@fluentui/react-icons";
import { useContext, useState } from "react";
import { ContainerDeploymentContext } from "./containerDeploymentStateProvider";
import { ApiStatus } from "../../../sharedInterfaces/webview";

const useStyles = makeStyles({
    outerDiv: {
        height: "fit-content",
        width: "500px",
        position: "relative",
        overflow: "auto",
    },
    spinnerDiv: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "20px",
    },
    leftHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    separatorDiv: {
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: "4px",
        background: tokens.colorNeutralStroke2,
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px",
    },
});

interface StepCardProps {
    stepName: string;
}

export const StepCard: React.FC<StepCardProps> = ({ stepName }) => {
    const classes = useStyles();
    const state = useContext(ContainerDeploymentContext);
    const containerDeploymentState = state?.state;
    const [expanded, setExpanded] = useState(false);

    const getLoadStatus = (stepName: string): ApiStatus => {
        switch (stepName) {
            case "dockerInstallStatus":
                return containerDeploymentState?.dockerInstallStatus.loadState;
            case "dockerStatus":
                return containerDeploymentState?.dockerStatus.loadState;
            case "dockerEngineStatus":
                return containerDeploymentState?.dockerEngineStatus.loadState;
            default:
                return ApiStatus.Error;
        }
    };

    const getHeaderText = (stepName: string): string => {
        switch (stepName) {
            case "dockerInstallStatus":
                return "Checking if Docker is installed";
            case "dockerStatus":
                return "Starting Docker";
            case "dockerEngineStatus":
                return "Starting Docker Engine";
            default:
                return "Unknown Step";
        }
    };

    const getBodyText = (stepName: string): string => {
        switch (stepName) {
            case "dockerInstallStatus":
                return "Install Text TBD";
            case "dockerStatus":
                return "Status Text TBD";
            case "dockerEngineStatus":
                return "Engine Text TBD";
            default:
                return "Unknown Step";
        }
    };

    const stepLoadStatus = getLoadStatus(stepName);

    const getStatusIcon = () => {
        if (stepLoadStatus === ApiStatus.Loaded) {
            return <Checkmark20Regular style={{ color: "green" }} />;
        }
        if (stepLoadStatus === ApiStatus.Error) {
            return <Dismiss20Regular style={{ color: "red" }} />;
        }
        return <Spinner size="tiny" />;
    };

    return (
        <Card className={classes.outerDiv}>
            <div className={classes.separatorDiv} />
            <div className={classes.header}>
                <div className={classes.leftHeader}>
                    {getStatusIcon()}
                    <span>{getHeaderText(stepName)}</span>
                </div>
                <Button
                    icon={
                        expanded ? (
                            <ChevronLeft20Regular />
                        ) : (
                            <ChevronUp20Regular />
                        )
                    }
                    appearance="subtle"
                    onClick={() => setExpanded(!expanded)}
                />
            </div>
            {expanded && (
                <div style={{ marginLeft: "32x" }}>{getBodyText(stepName)}</div>
            )}
        </Card>
    );
};
