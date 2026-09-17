/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, DialogActions, Text } from "@fluentui/react-components";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { areStepsComplete, hasStepErrored } from "../deployment/dabDeploymentUtils";
import { DabStepCard } from "../deployment/dabStepCard";
import { DabDialogContent, DabDialogTitle } from "./dabDialogLayout";

interface DabDeploymentPrerequisitesProps {
    target: Dab.DabDeploymentTarget;
    stepStatuses: Dab.DabDeploymentStepStatus[];
    onNext: () => void;
    onRetry: () => void;
    onBack: () => void;
    onCancel: () => void;
}

export const DabWizardPrerequisites = ({
    target,
    stepStatuses,
    onNext,
    onRetry,
    onBack,
    onCancel,
}: DabDeploymentPrerequisitesProps) => {
    const isComplete = areStepsComplete(stepStatuses);
    const hasError = hasStepErrored(stepStatuses);
    const isCli = target === Dab.DabDeploymentTarget.DabCli;

    return (
        <>
            <DabDialogTitle>
                {isCli
                    ? locConstants.schemaDesigner.gettingDabCliReady
                    : locConstants.localContainers.gettingDockerReady}
            </DabDialogTitle>
            <DabDialogContent>
                <Text>{locConstants.localContainers.checkingPrerequisites}</Text>
                <div style={{ display: "flex", flexDirection: "column", gap: 0, width: "100%" }}>
                    {stepStatuses.map((stepStatus) => (
                        <DabStepCard key={stepStatus.step} stepStatus={stepStatus} />
                    ))}
                </div>
            </DabDialogContent>
            <DialogActions>
                <Button appearance="secondary" onClick={onBack}>
                    {locConstants.common.back}
                </Button>
                <Button appearance="secondary" onClick={onCancel}>
                    {locConstants.common.cancel}
                </Button>
                {hasError && (
                    <Button appearance="primary" onClick={onRetry}>
                        {locConstants.common.retry}
                    </Button>
                )}
                {isComplete && (
                    <Button appearance="primary" onClick={onNext}>
                        {locConstants.common.next}
                    </Button>
                )}
            </DialogActions>
        </>
    );
};
