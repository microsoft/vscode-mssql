/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogSurface,
    makeStyles,
    Spinner,
    tokens,
} from "@fluentui/react-components";
import { useEffect } from "react";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { ApiStatus } from "../../../../../sharedInterfaces/webview";
import { DabDeploymentOverview } from "./dabDeploymentOverview";
import { DabDeploymentProgress } from "./dabDeploymentProgress";
import { DabDeploymentSetup } from "./dabDeploymentSetup";
import { DabDialogContent, DabDialogTitle } from "./dabDialogLayout";
import { useDabContext } from "../dabContext";

const useStyles = makeStyles({
    surface: {
        width: "960px",
        maxWidth: "calc(100vw - 48px)",
        height: "720px",
        maxHeight: "calc(100vh - 48px)",
    },
    body: {
        height: "100%",
        maxHeight: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        // Every view renders its title first. The negative margins cancel the
        // surface padding so the separator runs the full width of the dialog.
        "> :first-child": {
            marginLeft: "-24px",
            marginRight: "-24px",
            paddingLeft: "24px",
            paddingRight: "24px",
            paddingBottom: "16px",
            borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        },
        // The actions row is always last. Pinning it to the bottom keeps the
        // shorter views from leaving their buttons floating mid-dialog now
        // that the frame has a fixed height.
        "> :last-child": {
            marginTop: "auto",
            marginLeft: "-24px",
            marginRight: "-24px",
            paddingLeft: "24px",
            paddingRight: "24px",
            paddingTop: "16px",
            borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        },
    },
});

/**
 * The deployments experience for a database, which has at most one deployment.
 *
 * With no deployment, the dialog asks where to deploy. With one, it shows the
 * deployment; applying changes and restarting both redeploy it with the
 * current config, without going through setup again.
 *
 * The deployment itself is run by the extension. The dialog follows it, so
 * closing the dialog or the designer leaves the deployment running, listed in
 * Background Tasks, and reopening the dialog picks it up where it is.
 *
 * Kept apart from the toolbar's Deploy flow in ../deployment, which is the
 * original self-contained dialog and has to keep working unchanged when this
 * experience is switched off.
 */
export const DabDeploymentsDialog = () => {
    const classes = useStyles();
    const {
        dabDeploymentState,
        closeDabDeploymentDialog,
        resetDabDeploymentState,
        startDabDeployment,
        dabDeploymentRun,
        loadDabDeploymentRun,
        retryDabDeploymentRun,
        cancelDabDeploymentRun,
        dismissDabDeploymentRun,
        dabDeployments,
        dabDeploymentsStatus,
        loadDabDeployments,
    } = useDabContext();

    const { isDialogOpen } = dabDeploymentState;
    // Records are newest first. A database has one deployment; an older record
    // left from before that rule still holds its port but is not shown.
    const deployment = dabDeployments[0];
    const runStatus = dabDeploymentRun?.status;
    const isShowingRun = !!dabDeploymentRun && runStatus !== Dab.DabDeploymentRunStatus.Succeeded;

    // Opening the dialog picks up a run that may have started before, and the
    // deployment as it is now.
    useEffect(() => {
        if (isDialogOpen) {
            void loadDabDeploymentRun();
            void loadDabDeployments();
        }
    }, [isDialogOpen]);

    // A finished run hands over to the deployment view, which reloads to show
    // the deployment the run just made.
    useEffect(() => {
        if (isDialogOpen && runStatus === Dab.DabDeploymentRunStatus.Succeeded) {
            void dismissDabDeploymentRun().then(() => loadDabDeployments());
        }
    }, [isDialogOpen, runStatus]);

    /** Closes the dialog. A deployment in progress keeps running in the background. */
    const handleClose = () => {
        closeDabDeploymentDialog();
        resetDabDeploymentState();
    };

    /** Leaves a failed or canceled run and shows the deployment as it is now. */
    const handleBack = async () => {
        if (runStatus === Dab.DabDeploymentRunStatus.Failed) {
            // Removes what the failed attempt left behind before forgetting it.
            await cancelDabDeploymentRun();
        }
        await dismissDabDeploymentRun();
        await loadDabDeployments();
    };

    const renderHome = () => {
        const isLoading =
            dabDeploymentsStatus === ApiStatus.NotStarted ||
            dabDeploymentsStatus === ApiStatus.Loading;
        if (isLoading && !deployment) {
            return (
                <>
                    <DabDialogTitle>
                        {locConstants.schemaDesigner.deployDataApiBuilder}
                    </DabDialogTitle>
                    <DabDialogContent centered>
                        <Spinner
                            size="small"
                            label={locConstants.schemaDesigner.loadingDeployment}
                        />
                    </DabDialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={handleClose}>
                            {locConstants.common.close}
                        </Button>
                    </DialogActions>
                </>
            );
        }

        if (!deployment) {
            return (
                <DabDeploymentSetup
                    onDeploy={(selectedTarget, port) =>
                        void startDabDeployment(selectedTarget, undefined, port)
                    }
                    onCancel={handleClose}
                />
            );
        }

        return (
            <DabDeploymentOverview
                deployment={deployment}
                onRedeploy={() => void startDabDeployment(deployment.target, deployment.id)}
                onClose={handleClose}
            />
        );
    };

    return (
        <Dialog
            open={isDialogOpen}
            modalType="alert"
            onOpenChange={(_, data) => {
                if (!data.open) {
                    handleClose();
                }
            }}>
            <DialogSurface className={classes.surface}>
                <DialogBody className={classes.body}>
                    {isShowingRun && dabDeploymentRun ? (
                        <DabDeploymentProgress
                            run={dabDeploymentRun}
                            onRetry={() => void retryDabDeploymentRun()}
                            onBack={() => void handleBack()}
                            onCancelDeployment={() => void cancelDabDeploymentRun()}
                            onRunInBackground={handleClose}
                        />
                    ) : (
                        renderHome()
                    )}
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
