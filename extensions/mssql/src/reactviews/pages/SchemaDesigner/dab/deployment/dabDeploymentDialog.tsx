/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dialog, DialogBody, DialogSurface, makeStyles } from "@fluentui/react-components";
import { useContext, useEffect } from "react";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { SchemaDesignerContext } from "../../schemaDesignerStateProvider";
import { DabDeploymentConfirmation } from "./dabDeploymentConfirmation";
import { DabDeploymentPrerequisites } from "./dabDeploymentPrerequisites";
import { DabDeploymentInputForm } from "./dabDeploymentInputForm";
import { DabDeploymentProgress } from "./dabDeploymentProgress";
import { DabDeploymentComplete } from "./dabDeploymentComplete";
import { getPrereqSteps, getDeploySteps } from "./dabDeploymentUtils";

const useStyles = makeStyles({
    surface: {
        width: "600px",
        maxWidth: "600px",
        maxHeight: "80vh",
    },
});

export const DabDeploymentDialog = () => {
    const classes = useStyles();
    const context = useContext(SchemaDesignerContext);
    const {
        dabDeploymentState,
        closeDabDeploymentDialog,
        setDabDeploymentDialogStep,
        updateDabDeploymentParams,
        runDabDeploymentStep,
        resetDabDeploymentState,
        retryDabDeploymentSteps,
    } = context;

    const prereqSteps = getPrereqSteps(dabDeploymentState.stepStatuses);
    const deploySteps = getDeploySteps(dabDeploymentState.stepStatuses);

    // Determine which step to run based on current state
    // This effect runs on every state change and runs one step at a time
    useEffect(() => {
        const { dialogStep, currentDeploymentStep, stepStatuses } = dabDeploymentState;

        // Only run steps during Prerequisites or Deployment dialog steps
        if (
            dialogStep !== Dab.DabDeploymentDialogStep.Prerequisites &&
            dialogStep !== Dab.DabDeploymentDialogStep.Deployment
        ) {
            return;
        }

        // Check current step status
        const currentStepStatus = stepStatuses.find((s) => s.step === currentDeploymentStep);
        if (!currentStepStatus) {
            return;
        }

        // If current step is already running, completed, or errored, don't start it again
        if (currentStepStatus.status !== "notStarted") {
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
    }, [dabDeploymentState, runDabDeploymentStep]);

    const handleConfirm = () => {
        setDabDeploymentDialogStep(Dab.DabDeploymentDialogStep.Prerequisites);
    };

    const handleParamsSubmit = (params: Dab.DabDeploymentParams) => {
        updateDabDeploymentParams(params);
        setDabDeploymentDialogStep(Dab.DabDeploymentDialogStep.Deployment);
    };

    const handleRetry = () => {
        resetDabDeploymentState();
        setDabDeploymentDialogStep(Dab.DabDeploymentDialogStep.Prerequisites);
    };

    const handleClose = () => {
        closeDabDeploymentDialog();
        resetDabDeploymentState();
    };

    const renderContent = () => {
        switch (dabDeploymentState.dialogStep) {
            case Dab.DabDeploymentDialogStep.Confirmation:
                return (
                    <DabDeploymentConfirmation onConfirm={handleConfirm} onCancel={handleClose} />
                );
            case Dab.DabDeploymentDialogStep.Prerequisites:
                return (
                    <DabDeploymentPrerequisites
                        stepStatuses={prereqSteps}
                        onNext={() =>
                            setDabDeploymentDialogStep(Dab.DabDeploymentDialogStep.ParameterInput)
                        }
                        onRetry={handleRetry}
                        onCancel={handleClose}
                    />
                );
            case Dab.DabDeploymentDialogStep.ParameterInput:
                return (
                    <DabDeploymentInputForm
                        initialParams={dabDeploymentState.params}
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
                        onRetry={retryDabDeploymentSteps}
                        onBack={() => {
                            retryDabDeploymentSteps();
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
                        onRetry={() => {
                            retryDabDeploymentSteps();
                            setDabDeploymentDialogStep(Dab.DabDeploymentDialogStep.Deployment);
                        }}
                        onFinish={handleClose}
                    />
                );
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
