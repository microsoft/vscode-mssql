/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo } from "react";
import { Button } from "@fluentui/react-components";
import { Wizard, WizardPageDefinition } from "../../../common/wizard";
import { locConstants } from "../../../common/locConstants";
import { DeploymentDatabaseIcon } from "../../../common/icons/deploymentDatabase";
import { DeploymentWebviewState } from "../../../../sharedInterfaces/deployment";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { DeploymentContext } from "../deploymentStateProvider";
import { useDeploymentSelector } from "../deploymentSelector";
import {
    DockerStepOrder,
    LocalContainersState,
} from "../../../../sharedInterfaces/localContainers";
import { LocalContainersDeploymentInfoPage } from "./localContainersDeploymentInfoPage";
import { LocalContainersPrereqPage } from "./localContainersPrereqPage";
import { LocalContainersDeploymentFormPage } from "./localContainersDeploymentFormPage";
import { LocalContainersDeploymentProvisioningPage } from "./localContainersDeploymentProvisioningPage";
import { checkStepErrored, isLastStepLoaded } from "./localContainersDeploymentUtils";

interface LocalContainersDeploymentWizardProps {
    onBackToStart: () => void;
}

export const LocalContainersDeploymentWizard: React.FC<LocalContainersDeploymentWizardProps> = ({
    onBackToStart,
}) => {
    const context = useContext(DeploymentContext);
    const localContainersState = useDeploymentSelector(
        (s) => s.deploymentTypeState,
    ) as LocalContainersState;

    const localContainersWrappedState = useMemo(
        () =>
            ({
                deploymentTypeState: localContainersState,
            }) as DeploymentWebviewState,
        [localContainersState],
    );

    if (!context) {
        return undefined;
    }

    const pages: WizardPageDefinition[] = [
        {
            id: "local-info",
            title: locConstants.deployment.dockerSqlServerHeader,
            render: () => <LocalContainersDeploymentInfoPage />,
            nextLabel: locConstants.common.next,
            onPrevious: () => {
                onBackToStart();
                return false;
            },
        },
        {
            id: "local-prereqs",
            title: locConstants.localContainers.gettingDockerReady,
            render: () => <LocalContainersPrereqPage />,
            canGoNext: () =>
                isLastStepLoaded(localContainersWrappedState, DockerStepOrder.checkDockerEngine),
            extraFooterActions: () =>
                checkStepErrored(localContainersWrappedState) ? (
                    <Button appearance="secondary" onClick={() => context.resetDockerStepState()}>
                        {locConstants.common.retry}
                    </Button>
                ) : undefined,
        },
        {
            id: "local-form",
            title: locConstants.localContainers.sqlServerContainerHeader,
            render: (pageContext) => (
                <LocalContainersDeploymentFormPage
                    onValidated={() => pageContext.goToPage("local-provisioning")}
                />
            ),
            nextLabel: locConstants.localContainers.createContainer,
            canGoNext: () =>
                localContainersState?.loadState === ApiStatus.Loaded &&
                localContainersState?.formValidationLoadState !== ApiStatus.Loading,
            onNext: () => {
                context.checkDockerProfile();
                return false;
            },
        },
        {
            id: "local-provisioning",
            title: locConstants.localContainers.settingUp,
            render: () => <LocalContainersDeploymentProvisioningPage />,
            canGoBack: false,
            canGoNext: () =>
                isLastStepLoaded(localContainersWrappedState, DockerStepOrder.connectToContainer),
            showCancel: () => checkStepErrored(localContainersWrappedState),
            extraFooterActions: () =>
                checkStepErrored(localContainersWrappedState) ? (
                    <Button appearance="secondary" onClick={() => context.resetDockerStepState()}>
                        {locConstants.common.retry}
                    </Button>
                ) : undefined,
            onNext: () => {
                context.dispose();
                return false;
            },
        },
    ];

    return (
        <Wizard
            icon={<DeploymentDatabaseIcon aria-hidden="true" />}
            title={locConstants.deployment.deploymentHeader}
            pages={pages}
            onCancel={() => context.dispose()}
            maxContentWidth="wide"
        />
    );
};
