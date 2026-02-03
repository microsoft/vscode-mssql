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
import { useEffect, useState } from "react";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { dabStepLabels } from "./dabDeploymentUtils";

const useStyles = makeStyles({
    outerDiv: {
        height: "fit-content",
        width: "100%",
        position: "relative",
        overflow: "auto",
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
        padding: "8px",
    },
    leftHeader: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    topSpace: {
        marginTop: "8px",
    },
    bodyText: {
        marginLeft: "32px",
        marginBottom: "8px",
    },
});

interface DabStepCardProps {
    stepStatus: Dab.DabDeploymentStepStatus;
}

export const DabStepCard = ({ stepStatus }: DabStepCardProps) => {
    const classes = useStyles();
    const [expanded, setExpanded] = useState(true);
    const [showFullErrorText, setShowFullErrorText] = useState(false);

    const labels = dabStepLabels[stepStatus.step];
    const isError = stepStatus.status === "error";
    const isCompleted = stepStatus.status === "completed";

    // Auto-expand on error
    useEffect(() => {
        if (isError) {
            setExpanded(true);
        }
    }, [isError]);

    const getStatusIcon = () => {
        if (stepStatus.status === "notStarted") {
            return <Circle20Regular style={{ color: tokens.colorNeutralStroke1Pressed }} />;
        }
        if (stepStatus.status === "completed") {
            return <Checkmark20Regular style={{ color: tokens.colorStatusSuccessBackground3 }} />;
        }
        if (stepStatus.status === "error") {
            return <Dismiss20Regular style={{ color: tokens.colorStatusDangerBackground3 }} />;
        }
        // Running
        return <Spinner size="tiny" />;
    };

    return (
        <Card className={classes.outerDiv}>
            <div className={classes.separatorDiv} />
            <div className={classes.header}>
                <div className={classes.leftHeader}>
                    {getStatusIcon()}
                    <span>{labels.header}</span>
                </div>
                {!isCompleted && (
                    <Button
                        icon={expanded ? <ChevronDown20Regular /> : <ChevronUp20Regular />}
                        appearance="subtle"
                        onClick={() => setExpanded(!expanded)}
                    />
                )}
            </div>
            {expanded && !isCompleted && (
                <div className={classes.bodyText}>
                    {isError ? stepStatus.errorMessage : labels.body}

                    {isError && stepStatus.errorLink && (
                        <div className={classes.topSpace}>
                            <a
                                href={stepStatus.errorLink}
                                target="_blank"
                                rel="noopener noreferrer">
                                {stepStatus.errorLinkText}
                            </a>
                        </div>
                    )}
                    <div className={classes.topSpace}>
                        {isError && showFullErrorText && (
                            <div style={{ marginBottom: "8px" }}>{stepStatus.fullErrorText}</div>
                        )}
                        {stepStatus.fullErrorText && (
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
