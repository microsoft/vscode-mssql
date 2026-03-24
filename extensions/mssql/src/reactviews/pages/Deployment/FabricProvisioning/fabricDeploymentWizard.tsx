/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Button } from "@fluentui/react-components";
import { Wizard, WizardPageDefinition } from "../../../common/wizard";
import { locConstants } from "../../../common/locConstants";
import { DeploymentDatabaseIcon } from "../../../common/icons/deploymentDatabase";
import { FabricProvisioningState } from "../../../../sharedInterfaces/fabricProvisioning";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { DeploymentContext } from "../deploymentStateProvider";
import { useDeploymentSelector } from "../deploymentSelector";
import { FabricDeploymentInfoPage } from "./fabricDeploymentInfoPage";
import { FabricDeploymentFormPage } from "./fabricDeploymentFormPage";
import { FabricDeploymentProvisioningPage } from "./fabricDeploymentProvisioningPage";

interface FabricDeploymentWizardProps {
    onBackToStart: () => void;
}

export const FabricDeploymentWizard: React.FC<FabricDeploymentWizardProps> = ({
    onBackToStart,
}) => {
    const context = useContext(DeploymentContext);
    const fabricProvisioningState = useDeploymentSelector(
        (s) => s.deploymentTypeState,
    ) as FabricProvisioningState;

    if (!context) {
        return undefined;
    }

    const hasProvisioningError =
        fabricProvisioningState?.provisionLoadState === ApiStatus.Error ||
        fabricProvisioningState?.connectionLoadState === ApiStatus.Error;

    const pages: WizardPageDefinition[] = [
        {
            id: "fabric-info",
            title: locConstants.deployment.fabricProvisioningHeader,
            render: () => <FabricDeploymentInfoPage />,
            nextLabel: locConstants.common.next,
            onPrevious: () => {
                onBackToStart();
                return false;
            },
        },
        {
            id: "fabric-form",
            title: locConstants.fabricProvisioning.sqlDatabaseInFabric,
            render: (pageContext) => (
                <FabricDeploymentFormPage
                    onValidated={() => pageContext.goToPage("fabric-provisioning")}
                />
            ),
            nextLabel: locConstants.fabricProvisioning.createDatabase,
            canGoNext: () =>
                fabricProvisioningState?.loadState === ApiStatus.Loaded &&
                fabricProvisioningState?.formValidationLoadState !== ApiStatus.Loading &&
                !!fabricProvisioningState?.formState?.accountId &&
                !!fabricProvisioningState?.formState?.workspace,
            onNext: () => {
                context.createDatabase();
                return false;
            },
        },
        {
            id: "fabric-provisioning",
            title: locConstants.fabricProvisioning.provisioning,
            render: () => <FabricDeploymentProvisioningPage />,
            canGoBack: () => hasProvisioningError,
            canGoNext: () => fabricProvisioningState?.connectionLoadState === ApiStatus.Loaded,
            showCancel: () => hasProvisioningError,
            extraFooterActions: () =>
                hasProvisioningError ? (
                    <Button appearance="secondary" onClick={() => context.retryCreateDatabase()}>
                        {locConstants.common.retry}
                    </Button>
                ) : undefined,
            onPrevious: () => {
                context.resetFormValidationState();
            },
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
