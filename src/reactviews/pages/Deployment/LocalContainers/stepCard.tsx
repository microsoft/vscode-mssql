/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Spinner, Card, Button, makeStyles, tokens } from "@fluentui/react-components";
import {
    Checkmark20Regular,
    ChevronDown20Regular,
    ChevronUp20Regular,
    Circle20Regular,
    Dismiss20Regular,
} from "@fluentui/react-icons";
import { useContext, useEffect, useState } from "react";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { DockerStep } from "../../../../sharedInterfaces/localContainers";
import { locConstants } from "../../../common/locConstants";
import { DeploymentContext } from "../deploymentStateProvider";

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
    topSpace: {
        marginTop: "8px",
    },
});

interface StepCardProps {
    step: DockerStep;
}

export const StepCard: React.FC<StepCardProps> = ({ step }) => {
    const classes = useStyles();
    const state = useContext(DeploymentContext);
    const localContainersState = state?.state.deploymentTypeState;
    const [expanded, setExpanded] = useState(true);
    // This state is used to track if the step has just errored, and expand then
    const [isNewlyErrored, setIsNewlyErrored] = useState(false);
    const [showFullErrorText, setShowFullErrorText] = useState(false);

    // If this passes, container deployment state is guaranteed
    // to be defined, so we can reference it as non-null
    if (!state) {
        return undefined;
    }

    useEffect(() => {
        if (!isNewlyErrored && step.loadState === ApiStatus.Error) {
            setExpanded(true);
            setIsNewlyErrored(true);
        }
    }, [state.state]);

    const getStatusIcon = () => {
        if (step.loadState === ApiStatus.NotStarted) {
            return <Circle20Regular style={{ color: "gray" }} />;
        }
        if (step.loadState === ApiStatus.Loaded) {
            return <Checkmark20Regular style={{ color: "green" }} />;
        }
        if (step.loadState === ApiStatus.Error) {
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
                    <span>{step.headerText}</span>
                </div>
                {step.loadState !== ApiStatus.Loaded && (
                    <Button
                        icon={expanded ? <ChevronDown20Regular /> : <ChevronUp20Regular />}
                        appearance="subtle"
                        onClick={() => setExpanded(!expanded)}
                    />
                )}
            </div>
            {expanded && step.loadState !== ApiStatus.Loaded && (
                <div style={{ marginLeft: "32px" }}>
                    {step.loadState === ApiStatus.Error ? step.errorMessage : step.bodyText}

                    {/* If step.errorLink is defined and API is in error, render it */}
                    {step.loadState === ApiStatus.Error && step.errorLink && (
                        <div className={classes.topSpace}>
                            <a
                                href={step.errorLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={classes.topSpace}>
                                {step.errorLinkText}
                            </a>
                        </div>
                    )}
                    <div className={classes.topSpace}>
                        {step.loadState === ApiStatus.Error && showFullErrorText && (
                            <div style={{ marginBottom: "8px" }}>{step.fullErrorText}</div>
                        )}

                        {step.fullErrorText && (
                            <a onClick={() => setShowFullErrorText(!showFullErrorText)}>
                                {showFullErrorText
                                    ? locConstants.localContainers.hideFullErrorMessage
                                    : locConstants.localContainers.showFullErrorMessage}
                            </a>
                        )}
                    </div>
                </div>
            )}
        </Card>
    );
};
