/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dialog, DialogBody, DialogSurface, makeStyles } from "@fluentui/react-components";
import { useEffect } from "react";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { ApiStatus } from "../../../../../sharedInterfaces/webview";
import { DabDeploymentConfirmation } from "./dabDeploymentConfirmation";
import { DabDeploymentPrerequisites } from "./dabDeploymentPrerequisites";
import { DabDeploymentInputForm } from "./dabDeploymentInputForm";
import { DabDeploymentProgress } from "./dabDeploymentProgress";
import { DabDeploymentComplete } from "./dabDeploymentComplete";
import { DabDeploymentsList } from "./dabDeploymentsList";
import { DabDeploymentTargetPicker } from "./dabDeploymentTargetPicker";
import { getPrereqSteps, getDeploySteps } from "./dabDeploymentUtils";
import { useDabContext } from "../dabContext";

const useStyles = makeStyles({
    surface: {
        width: "640px",
        maxWidth: "640px",
        maxHeight: "80vh",
    },
});

export const DabDeploymentDialog = () => {
    const classes = useStyles();
    const context = useDabContext();
    const {
        dabDeploymentState,
        closeDabDeploymentDialog,
        setDabDeploymentDialogView,
        setDabDeploymentDialogStep,
        updateDabDeploymentParams,
        validateDabDeploymentParams,
        runDabDeploymentStep,
        resetDabDeploymentState,
        startNewDabDeployment,
        restartDabDeploymentFlow,
        retryDabDeploymentSteps,
        loadDabDeployments,
    } = context;

    const { dialogView, dialogStep, currentDeploymentStep, stepStatuses, mode } =
        dabDeploymentState;
    const prereqSteps = getPrereqSteps(stepStatuses);
    const deploySteps = getDeploySteps(stepStatuses);
    const isRedeploy = mode === Dab.DabDeploymentMode.Redeploy;

    // Determine which step to run based on current state
    // This effect runs when relevant state changes and runs one step at a time
    useEffect(() => {
        // Only run steps while the wizard is showing its step-driven views
        if (
            dialogView !== Dab.DabDeploymentDialogView.Wizard ||
            (dialogStep !== Dab.DabDeploymentDialogStep.Prerequisites &&
                dialogStep !== Dab.DabDeploymentDialogStep.Deployment)
        ) {
            return;
        }

        // Check current step status
        const currentStepStatus = stepStatuses.find((s) => s.step === currentDeploymentStep);
        if (!currentStepStatus) {
            return;
        }

        // If current step is already running, completed, or errored, don't start it again
        if (currentStepStatus.status !== ApiStatus.NotStarted) {
            return;
        }

        // Determine if current step is within the range for this dialog step
        const isPrereqStep = currentDeploymentStep <= Dab.DabDeploymentStepOrder.checkDockerEngine;
        const isDeployStep = currentDeploymentStep >= Dab.DabDeploymentStepOrder.pullImage;

        if (dialogStep === Dab.DabDeploymentDialogStep.Prerequisites && isPrereqStep) {
            void runDabDeploymentStep(currentDeploymentStep);
        } else if (dialogStep === Dab.DabDeploymentDialogStep.Deployment && isDeployStep) {
            void runDabDeploymentStep(currentDeploymentStep);
        }
    }, [dialogView, dialogStep, currentDeploymentStep, stepStatuses, runDabDeploymentStep]);

    const handleConfirm = () => {
        setDabDeploymentDialogStep(Dab.DabDeploymentDialogStep.Prerequisites);
    };

    const handleParamsSubmit = (params: Dab.DabDeploymentParams) => {
        updateDabDeploymentParams(params);
        setDabDeploymentDialogStep(Dab.DabDeploymentDialogStep.Deployment);
    };

    const handleRetry = () => {
        restartDabDeploymentFlow();
    };

    const handleClose = () => {
        closeDabDeploymentDialog();
        resetDabDeploymentState();
    };

    /**
     * A finished deployment belongs in the list, where it can be redeployed or
     * removed later. Refreshing first means the new container is already there
     * when the list renders.
     */
    const handleShowDeployments = async () => {
        await loadDabDeployments();
        setDabDeploymentDialogView(Dab.DabDeploymentDialogView.List);
    };

    /**
     * Prerequisites are already satisfied for a redeployment's container name
     * and port, so redeploying skips the parameter form and reuses them.
     */
    const handlePrerequisitesNext = () => {
        setDabDeploymentDialogStep(
            isRedeploy
                ? Dab.DabDeploymentDialogStep.Deployment
                : Dab.DabDeploymentDialogStep.ParameterInput,
        );
    };

    const renderWizard = () => {
        switch (dialogStep) {
            case Dab.DabDeploymentDialogStep.Confirmation:
                return (
                    <DabDeploymentConfirmation
                        apiTypes={context.dabConfig?.apiTypes ?? []}
                        onConfirm={handleConfirm}
                        onCancel={handleClose}
                    />
                );
            case Dab.DabDeploymentDialogStep.Prerequisites:
                return (
                    <DabDeploymentPrerequisites
                        stepStatuses={prereqSteps}
                        onNext={handlePrerequisitesNext}
                        onRetry={handleRetry}
                        onCancel={handleClose}
                    />
                );
            case Dab.DabDeploymentDialogStep.ParameterInput:
                return (
                    <DabDeploymentInputForm
                        initialParams={dabDeploymentState.params}
                        validateParams={validateDabDeploymentParams}
                        onSubmit={handleParamsSubmit}
                        onCancel={handleClose}
                    />
                );
            case Dab.DabDeploymentDialogStep.Deployment:
                return (
                    <DabDeploymentProgress
                        containerName={dabDeploymentState.params.containerName}
                        stepStatuses={deploySteps}
                        onNext={() =>
                            setDabDeploymentDialogStep(Dab.DabDeploymentDialogStep.Complete)
                        }
                        onRetry={async () => {
                            await retryDabDeploymentSteps();
                        }}
                        onBack={async () => {
                            await retryDabDeploymentSteps();
                            setDabDeploymentDialogStep(Dab.DabDeploymentDialogStep.ParameterInput);
                        }}
                        onCancel={handleClose}
                    />
                );
            case Dab.DabDeploymentDialogStep.Complete:
                return (
                    <DabDeploymentComplete
                        apiUrl={dabDeploymentState.apiUrl}
                        error={dabDeploymentState.error}
                        onRetry={async () => {
                            await retryDabDeploymentSteps();
                            setDabDeploymentDialogStep(Dab.DabDeploymentDialogStep.Deployment);
                        }}
                        onFinish={() => void handleShowDeployments()}
                    />
                );
            default:
                return null;
        }
    };

    const renderContent = () => {
        switch (dialogView) {
            case Dab.DabDeploymentDialogView.List:
                return (
                    <DabDeploymentsList
                        onCreateNew={() =>
                            setDabDeploymentDialogView(Dab.DabDeploymentDialogView.TargetSelection)
                        }
                        onClose={handleClose}
                    />
                );
            case Dab.DabDeploymentDialogView.TargetSelection:
                return (
                    <DabDeploymentTargetPicker
                        onSelectTarget={() => startNewDabDeployment()}
                        onBack={() => setDabDeploymentDialogView(Dab.DabDeploymentDialogView.List)}
                        onCancel={handleClose}
                    />
                );
            case Dab.DabDeploymentDialogView.Wizard:
                return renderWizard();
            default:
                return null;
        }
    };

    return (
        <Dialog
            open={dabDeploymentState.isDialogOpen}
            modalType="alert"
            onOpenChange={(_, data) => {
                if (!data.open) {
                    handleClose();
                }
            }}>
            <DialogSurface className={classes.surface}>
                <DialogBody>{renderContent()}</DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
