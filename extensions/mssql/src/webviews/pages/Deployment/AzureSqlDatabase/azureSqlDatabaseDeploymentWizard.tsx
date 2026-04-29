/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo } from "react";
import { Wizard, WizardPageDefinition } from "../../../common/wizard";
import { locConstants } from "../../../common/locConstants";
import { CreateDatabaseIcon } from "../../../common/icons/createDatabase";
import {
    AzureSqlDatabaseFormItemSpec,
    AzureSqlDatabaseState,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { DeploymentContext } from "../deploymentStateProvider";
import { useAzureSqlDatabaseDeploymentSelector } from "../deploymentSelector";
import { AzureSqlDatabaseInfoPage } from "./azureSqlDatabaseInfoPage";
import { AzureSqlDatabaseFormPage } from "./azureSqlDatabaseFormPage";
import { AzureSqlDatabaseProvisioningPage } from "./azureSqlDatabaseProvisioningPage";

interface AzureSqlDatabaseDeploymentWizardProps {
    onBackToStart: () => void;
}

export const AzureSqlDatabaseDeploymentWizard: React.FC<AzureSqlDatabaseDeploymentWizardProps> = ({
    onBackToStart,
}) => {
    const context = useContext(DeploymentContext);
    const loadState = useAzureSqlDatabaseDeploymentSelector((s) => s.loadState);
    const formState = useAzureSqlDatabaseDeploymentSelector((s) => s.formState);
    const formComponents = useAzureSqlDatabaseDeploymentSelector((s) => s.formComponents);
    const formValidationLoadState = useAzureSqlDatabaseDeploymentSelector(
        (s) => s.formValidationLoadState,
    );
    const provisionLoadState = useAzureSqlDatabaseDeploymentSelector((s) => s.provisionLoadState);

    if (!context) {
        return undefined;
    }

    const validationState = useMemo(
        () =>
            new AzureSqlDatabaseState({
                loadState,
                formState,
                formComponents,
            }),
        [formComponents, formState, loadState],
    );

    const hasProvisioningError = provisionLoadState === ApiStatus.Error;
    const isStateReady = !!formState && !!formComponents && "accountId" in formComponents;
    const isFormValid =
        loadState === ApiStatus.Loaded &&
        Object.values(formComponents ?? {}).every((component) => {
            const formComponent = component as AzureSqlDatabaseFormItemSpec | undefined;
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
            id: "azure-sql-info",
            title: locConstants.azureSqlDatabase.azureSqlDatabaseHeader,
            render: () => <AzureSqlDatabaseInfoPage />,
            nextLabel: locConstants.common.next,
            canGoNext: () => isStateReady,
            onPrevious: () => {
                onBackToStart();
                return false;
            },
        },
        {
            id: "azure-sql-form",
            title: locConstants.azureSqlDatabase.azureSqlDatabaseHeader,
            render: (pageContext) => (
                <AzureSqlDatabaseFormPage
                    onValidated={() => pageContext.goToPage("azure-sql-provisioning")}
                />
            ),
            nextLabel: locConstants.azureSqlDatabase.createDatabase,
            canGoNext: () =>
                isFormValid &&
                formValidationLoadState !== ApiStatus.Loading &&
                !!formState?.accountId,
            onNext: () => {
                context.startAzureSqlDatabaseDeployment();
                return false;
            },
        },
        {
            id: "azure-sql-provisioning",
            title: locConstants.azureSqlDatabase.provisioning,
            render: () => <AzureSqlDatabaseProvisioningPage />,
            canGoBack: () => hasProvisioningError,
            canGoNext: () => provisionLoadState === ApiStatus.Loaded,
            showCancel: () => hasProvisioningError,
            onPrevious: () => {
                // Reset validation so the user can re-submit
                context.formAction({
                    propertyName: "databaseName",
                    isAction: false,
                    value: formState?.databaseName ?? "",
                });
            },
            onNext: () => {
                context.dispose();
                return false;
            },
        },
    ];

    return (
        <Wizard
            icon={<CreateDatabaseIcon aria-hidden="true" />}
            title={locConstants.deployment.deploymentHeader}
            pages={pages}
            onCancel={() => context.dispose()}
            maxContentWidth="wide"
        />
    );
};
