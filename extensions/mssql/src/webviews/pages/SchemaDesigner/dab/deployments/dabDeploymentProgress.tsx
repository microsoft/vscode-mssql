/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, DialogActions, Link, makeStyles, Text, tokens } from "@fluentui/react-components";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { useDabContext } from "../dabContext";
import { useSchemaDesignerSelector } from "../../schemaDesignerSelector";
import { DabDialogContent } from "./dabDialogLayout";
import { buildDeploymentLog, DabDeploymentStepList } from "./dabDeploymentStepList";

const useStyles = makeStyles({
    header: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
    },
    title: {
        fontSize: tokens.fontSizeBase500,
        lineHeight: tokens.lineHeightBase500,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
    subtitle: {
        color: tokens.colorNeutralForeground3,
        overflowWrap: "anywhere",
    },
    content: {
        // The list keeps its rows at their natural height and the content
        // scrolls, so nothing in a row is ever clipped.
        overflowY: "auto",
    },
    footer: {
        justifyContent: "flex-start",
    },
    footerLink: {
        marginLeft: "8px",
    },
});

interface DabDeploymentProgressProps {
    run: Dab.DabDeploymentRunState;
    onRetry: () => void;
    onBack: () => void;
    onCancelDeployment: () => void;
    onRunInBackground: () => void;
}

/**
 * Follows a deployment run. The extension runs the steps, so closing the
 * dialog only hides them: the run carries on and shows in Background Tasks.
 */
export const DabDeploymentProgress = ({
    run,
    onRetry,
    onBack,
    onCancelDeployment,
    onRunInBackground,
}: DabDeploymentProgressProps) => {
    const classes = useStyles();
    const { openLogsInNewTab } = useDabContext();
    const databaseName = useSchemaDesignerSelector((s) => s?.dabDatabaseName) ?? "";
    const isFailed = run.status === Dab.DabDeploymentRunStatus.Failed;
    const isCanceled = run.status === Dab.DabDeploymentRunStatus.Canceled;
    const isActive =
        run.status === Dab.DabDeploymentRunStatus.Running ||
        run.status === Dab.DabDeploymentRunStatus.Waiting;

    const status = isFailed
        ? locConstants.schemaDesigner.dabDeploymentFailed
        : isCanceled
          ? locConstants.schemaDesigner.dabDeploymentCanceled
          : run.status === Dab.DabDeploymentRunStatus.Waiting
            ? locConstants.schemaDesigner.dabDeploymentWaiting
            : undefined;
    const subtitle = status
        ? locConstants.schemaDesigner.dabDeploymentSubtitle(databaseName, status)
        : databaseName;

    return (
        <>
            <div className={classes.header}>
                <Text as="h2" className={classes.title}>
                    {run.mode === Dab.DabDeploymentMode.Redeploy
                        ? locConstants.schemaDesigner.updatingDataApiBuilder
                        : locConstants.schemaDesigner.deployingDataApiBuilder}
                </Text>
                {subtitle && (
                    <Text className={classes.subtitle} aria-live="polite">
                        {subtitle}
                    </Text>
                )}
            </div>
            <DabDialogContent className={classes.content}>
                <DabDeploymentStepList stepStatuses={run.stepStatuses} />
            </DabDialogContent>
            <DialogActions className={classes.footer} fluid>
                {isFailed && (
                    <Button appearance="primary" onClick={onRetry}>
                        {locConstants.common.retry}
                    </Button>
                )}
                {(isFailed || isCanceled) && (
                    <Button appearance="secondary" onClick={onBack}>
                        {locConstants.common.back}
                    </Button>
                )}
                {isActive && (
                    <Button appearance="secondary" onClick={onRunInBackground}>
                        {locConstants.schemaDesigner.runInBackground}
                    </Button>
                )}
                {(isActive || isFailed) && (
                    <Button appearance="secondary" onClick={onCancelDeployment}>
                        {locConstants.schemaDesigner.cancelDeployment}
                    </Button>
                )}
                <Link
                    className={classes.footerLink}
                    onClick={() => openLogsInNewTab(buildDeploymentLog(run.stepStatuses))}>
                    {locConstants.schemaDesigner.showDeploymentLog}
                </Link>
            </DialogActions>
        </>
    );
};
