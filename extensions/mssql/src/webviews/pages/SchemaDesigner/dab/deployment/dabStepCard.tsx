/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Text, makeStyles, tokens, Toolbar } from "@fluentui/react-components";
import {
    ChevronDown20Regular,
    ChevronUp20Regular,
    Copy16Regular,
    Open16Regular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { ApiStatus } from "../../../../../sharedInterfaces/webview";
import { useDabContext } from "../dabContext";
import { getDabStepLabels } from "./dabDeploymentUtils";
import { DeploymentStepCard } from "../../../Deployment/deploymentStepCard";

const useStyles = makeStyles({
    topSpace: {
        marginTop: "8px",
    },
    bodyText: {
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
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    errorToggle: {
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: tokens.colorBrandForegroundLink,
        font: "inherit",
        textDecoration: "underline",
    },
    fullError: {
        marginBottom: "8px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        color: tokens.colorNeutralForeground2,
    },
    logPreview: {
        margin: 0,
        padding: "8px",
        maxHeight: "100px",
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
    const { copyToClipboard, openLogsInNewTab } = useDabContext();
    const [expanded, setExpanded] = useState(true);
    const [showFullError, setShowFullError] = useState(false);

    const labels = getDabStepLabels()[stepStatus.step];
    const isError = stepStatus.status === ApiStatus.Error;
    const isCompleted = stepStatus.status === ApiStatus.Loaded;
    const hasContainerLogs = !!stepStatus.containerLogs?.trim();
    // The summary names the kind of failure; the underlying error names the
    // cause. Only offer it when it adds something the summary does not.
    const fullErrorText = stepStatus.fullErrorText?.trim();
    const hasFullErrorText = !!fullErrorText && fullErrorText !== stepStatus.message?.trim();

    // Auto-expand on error
    useEffect(() => {
        if (isError) {
            setExpanded(true);
        }
    }, [isError]);

    // A retry that fails differently deserves to be read from the top.
    useEffect(() => {
        setShowFullError(false);
    }, [fullErrorText]);

    return (
        <DeploymentStepCard
            status={stepStatus.status}
            title={labels.header}
            headerAction={
                !isCompleted ? (
                    <Button
                        icon={expanded ? <ChevronDown20Regular /> : <ChevronUp20Regular />}
                        appearance="subtle"
                        onClick={() => setExpanded(!expanded)}
                    />
                ) : undefined
            }>
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
                    {isError && hasFullErrorText && (
                        <div className={classes.topSpace}>
                            {showFullError && (
                                <div className={classes.fullError}>{fullErrorText}</div>
                            )}
                            <button
                                type="button"
                                className={classes.errorToggle}
                                onClick={() => setShowFullError(!showFullError)}>
                                {showFullError
                                    ? locConstants.schemaDesigner.hideFullErrorMessage
                                    : locConstants.schemaDesigner.showFullErrorMessage}
                            </button>
                        </div>
                    )}
                    {isError && hasContainerLogs && (
                        <div className={classes.logSection}>
                            <div className={classes.logHeader}>
                                <Text weight="semibold">
                                    {locConstants.schemaDesigner.containerLogs}
                                </Text>
                                <Toolbar size="small">
                                    <Button
                                        size="small"
                                        appearance="subtle"
                                        icon={<Copy16Regular />}
                                        title={locConstants.common.copy}
                                        aria-label={locConstants.common.copy}
                                        onClick={() =>
                                            copyToClipboard(
                                                stepStatus.containerLogs ?? "",
                                                Dab.CopyTextType.Logs,
                                            )
                                        }>
                                        {locConstants.common.copy}
                                    </Button>
                                    <Button
                                        size="small"
                                        appearance="subtle"
                                        icon={<Open16Regular />}
                                        title={locConstants.queryResult.openResultInNewTab}
                                        aria-label={locConstants.queryResult.openResultInNewTab}
                                        onClick={() =>
                                            openLogsInNewTab(stepStatus.containerLogs ?? "")
                                        }>
                                        {locConstants.queryResult.openResultInNewTab}
                                    </Button>
                                </Toolbar>
                            </div>
                            <pre className={classes.logPreview}>{stepStatus.containerLogs}</pre>
                        </div>
                    )}
                </div>
            )}
        </DeploymentStepCard>
    );
};
