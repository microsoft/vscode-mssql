/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Spinner, Card, Button, Text, makeStyles, tokens } from "@fluentui/react-components";
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
import { ApiStatus } from "../../../../../sharedInterfaces/webview";
import { getDabStepLabels } from "./dabDeploymentUtils";

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
    logSection: {
        marginTop: "12px",
        marginRight: "8px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        overflow: "hidden",
        background: tokens.colorNeutralBackground2,
    },
    logHeader: {
        padding: "6px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    logOutput: {
        margin: 0,
        padding: "8px",
        maxHeight: "220px",
        overflowY: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        background: tokens.colorNeutralBackground1,
    },
});

interface DabStepCardProps {
    stepStatus: Dab.DabDeploymentStepStatus;
}

export const DabStepCard = ({ stepStatus }: DabStepCardProps) => {
    const classes = useStyles();
    const [expanded, setExpanded] = useState(true);
    const [showFullErrorText, setShowFullErrorText] = useState(false);

    const labels = getDabStepLabels()[stepStatus.step];
    const isError = stepStatus.status === ApiStatus.Error;
    const isCompleted = stepStatus.status === ApiStatus.Loaded;
    const hasContainerLogs = !!stepStatus.containerLogs?.trim();

    // Auto-expand on error
    useEffect(() => {
        if (isError) {
            setExpanded(true);
        }
    }, [isError]);

    const getStatusIcon = () => {
        if (stepStatus.status === ApiStatus.NotStarted) {
            return <Circle20Regular style={{ color: tokens.colorNeutralStroke1Pressed }} />;
        }
        if (stepStatus.status === ApiStatus.Loaded) {
            return <Checkmark20Regular style={{ color: tokens.colorStatusSuccessBackground3 }} />;
        }
        if (stepStatus.status === ApiStatus.Error) {
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
                    {isError ? stepStatus.message : labels.body}

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
                    {hasContainerLogs && (
                        <div className={classes.logSection}>
                            <Text block weight="semibold" className={classes.logHeader}>
                                {locConstants.schemaDesigner.containerLogs}
                            </Text>
                            <pre className={classes.logOutput}>{stepStatus.containerLogs}</pre>
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
