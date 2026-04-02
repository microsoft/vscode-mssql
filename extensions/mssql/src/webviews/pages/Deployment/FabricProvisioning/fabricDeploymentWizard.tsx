/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo } from "react";
import { Button } from "@fluentui/react-components";
import { Wizard, WizardPageDefinition } from "../../../common/wizard";
import { locConstants } from "../../../common/locConstants";
import { SqlDbInFabricIcon } from "../../../common/icons/sqlDbInFabric";
import {
    FabricProvisioningFormItemSpec,
    FabricProvisioningState,
} from "../../../../sharedInterfaces/fabricProvisioning";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { DeploymentContext } from "../deploymentStateProvider";
import { useFabricDeploymentSelector } from "../deploymentSelector";
import { FabricDeploymentInfoPage } from "./fabricDeploymentInfoPage";
import { FabricDeploymentFormPage } from "./fabricDeploymentFormPage";
import { FabricDeploymentProvisioningPage } from "./fabricDeploymentProvisioningPage";

interface FabricDeploymentWizardProps {
    onBackToStart: () => void;
    initialPageId?: string;
}

export const FabricDeploymentWizard: React.FC<FabricDeploymentWizardProps> = ({
    onBackToStart,
    initialPageId,
}) => {
    const context = useContext(DeploymentContext);
    const loadState = useFabricDeploymentSelector((s) => s.loadState);
    const formState = useFabricDeploymentSelector((s) => s.formState);
    const formComponents = useFabricDeploymentSelector((s) => s.formComponents);
    const formValidationLoadState = useFabricDeploymentSelector((s) => s.formValidationLoadState);
    const provisionLoadState = useFabricDeploymentSelector((s) => s.provisionLoadState);
    const connectionLoadState = useFabricDeploymentSelector((s) => s.connectionLoadState);
    const workspacesWithPermissions = useFabricDeploymentSelector(
        (s) => s.workspacesWithPermissions,
    );
    const databaseNamesInWorkspace = useFabricDeploymentSelector((s) => s.databaseNamesInWorkspace);

    if (!context) {
        return undefined;
    }

    const validationState = useMemo(
        () =>
            new FabricProvisioningState({
                loadState,
                formState,
                formComponents,
                workspacesWithPermissions,
                databaseNamesInWorkspace,
            }),
        [databaseNamesInWorkspace, formComponents, formState, loadState, workspacesWithPermissions],
    );

    const hasProvisioningError =
        provisionLoadState === ApiStatus.Error || connectionLoadState === ApiStatus.Error;
    const isFabricStateReady = !!formState && !!formComponents && "accountId" in formComponents;
    const isFabricFormValid =
        loadState === ApiStatus.Loaded &&
        Object.values(formComponents ?? {}).every((component) => {
            const formComponent = component as FabricProvisioningFormItemSpec | undefined;
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
            id: "fabric-info",
            title: locConstants.deployment.fabricProvisioningHeader,
            render: () => <FabricDeploymentInfoPage />,
            nextLabel: locConstants.common.next,
            canGoNext: () => isFabricStateReady,
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
                isFabricFormValid &&
                formValidationLoadState !== ApiStatus.Loading &&
                !!formState?.accountId &&
                !!formState?.workspace,
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
            canGoNext: () => connectionLoadState === ApiStatus.Loaded,
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
            icon={<SqlDbInFabricIcon aria-hidden="true" />}
            title={locConstants.deployment.deploymentHeader}
            pages={pages}
            onCancel={() => context.dispose()}
            maxContentWidth="wide"
            initialPageId={initialPageId}
        />
    );
};
