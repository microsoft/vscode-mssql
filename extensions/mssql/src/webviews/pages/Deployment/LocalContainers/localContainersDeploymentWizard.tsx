/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo } from "react";
import { Button } from "@fluentui/react-components";
import { Wizard, WizardPageDefinition } from "../../../common/wizard";
import { locConstants } from "../../../common/locConstants";
import { DockerIcon } from "../../../common/icons/docker";
import { DeploymentWebviewState } from "../../../../sharedInterfaces/deployment";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { DeploymentContext } from "../deploymentStateProvider";
import { useLocalContainersDeploymentSelector } from "../deploymentSelector";
import {
    DockerStepOrder,
    LocalContainersFormItemSpec,
    LocalContainersState,
} from "../../../../sharedInterfaces/localContainers";
import { LocalContainersDeploymentInfoPage } from "./localContainersDeploymentInfoPage";
import { LocalContainersPrereqPage } from "./localContainersPrereqPage";
import { LocalContainersDeploymentFormPage } from "./localContainersDeploymentFormPage";
import { LocalContainersDeploymentProvisioningPage } from "./localContainersDeploymentProvisioningPage";
import { checkStepErrored, isLastStepLoaded } from "./localContainersDeploymentUtils";

interface LocalContainersDeploymentWizardProps {
    onBackToStart: () => void;
    initialPageId?: string;
}

export const LocalContainersDeploymentWizard: React.FC<LocalContainersDeploymentWizardProps> = ({
    onBackToStart,
    initialPageId,
}) => {
    const context = useContext(DeploymentContext);
    const loadState = useLocalContainersDeploymentSelector((s) => s.loadState);
    const dockerSteps = useLocalContainersDeploymentSelector((s) => s.dockerSteps);
    const currentDockerStep = useLocalContainersDeploymentSelector((s) => s.currentDockerStep);
    const formState = useLocalContainersDeploymentSelector((s) => s.formState);
    const formComponents = useLocalContainersDeploymentSelector((s) => s.formComponents);
    const formValidationLoadState = useLocalContainersDeploymentSelector(
        (s) => s.formValidationLoadState,
    );

    const localContainersWrappedState = useMemo(
        () =>
            ({
                deploymentTypeState: new LocalContainersState({
                    dockerSteps,
                    currentDockerStep,
                }),
            }) as DeploymentWebviewState,
        [currentDockerStep, dockerSteps],
    );

    const validationState = useMemo(
        () =>
            new LocalContainersState({
                loadState,
                formState,
                formComponents,
            }),
        [formComponents, formState, loadState],
    );

    if (!context) {
        return undefined;
    }

    const isLocalContainersStateReady = Array.isArray(dockerSteps);
    const isLocalContainersFormValid =
        loadState === ApiStatus.Loaded &&
        Object.values(formComponents ?? {}).every((component) => {
            const formComponent = component as LocalContainersFormItemSpec | undefined;
            if (!formComponent) {
                return true;
            }

            const value = formState?.[formComponent.propertyName];
            const normalizedValue = (value ?? "") as string | number | boolean;
            if (formComponent.validate) {
                return formComponent.validate(validationState, normalizedValue).isValid;
            }

            return formComponent.required ? !!value : true;
        });

    const pages: WizardPageDefinition[] = [
        {
            id: "local-info",
            title: locConstants.deployment.dockerSqlServerHeader,
            render: () => <LocalContainersDeploymentInfoPage />,
            nextLabel: locConstants.common.next,
            canGoNext: () => isLocalContainersStateReady,
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
                isLocalContainersFormValid && formValidationLoadState !== ApiStatus.Loading,
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
            icon={<DockerIcon aria-hidden="true" />}
            title={locConstants.deployment.deploymentHeader}
            pages={pages}
            onCancel={() => context.dispose()}
            maxContentWidth="wide"
            initialPageId={initialPageId}
        />
    );
};
