/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useMemo, useState } from "react";
import { Wizard, WizardPageDefinition } from "../../../common/wizard";
import { locConstants } from "../../../common/locConstants";
import { AzureSqlDatabaseIcon } from "../../../common/icons/azureSqlDatabase";
import {
    AzureSqlDatabaseFormItemSpec,
    AzureSqlDatabaseFormState,
    AzureSqlDatabaseState,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import { AuthenticationType } from "../../../../sharedInterfaces/connectionDialog";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { DeploymentContext } from "../deploymentStateProvider";
import { useAzureSqlDatabaseDeploymentSelector } from "../deploymentSelector";
import { AzureSqlDatabaseInfoPage } from "./azureSqlDatabaseInfoPage";
import { AzureSqlDatabaseFormPage } from "./azureSqlDatabaseFormPage";
import { AzureSqlDatabaseProvisioningPage } from "./azureSqlDatabaseProvisioningPage";

export interface TagEntry {
    id: number;
    key: string;
    value: string;
}

function isAzureSqlFormValid(
    loadState: ApiStatus,
    formState: AzureSqlDatabaseFormState | undefined,
    formComponents:
        | Partial<Record<keyof AzureSqlDatabaseFormState, AzureSqlDatabaseFormItemSpec>>
        | undefined,
    serverCreatedWithAuth: boolean,
    validationState: AzureSqlDatabaseState,
): boolean {
    if (loadState !== ApiStatus.Loaded) {
        return false;
    }

    return Object.values(formComponents ?? {}).every((component) => {
        const formComponent = component as AzureSqlDatabaseFormItemSpec | undefined;
        if (!formComponent) {
            return true;
        }

        const value = formState?.[formComponent.propertyName];
        const normalizedValue = (value ?? "") as string | number | boolean;

        // validate functions don't survive JSON serialization to the webview,
        // so replicate auth-type-conditional logic for userName/password here
        if (
            (formComponent.propertyName === "userName" ||
                formComponent.propertyName === "password") &&
            (formState?.authenticationType === AuthenticationType.AzureMFA || serverCreatedWithAuth)
        ) {
            return true;
        }

        // savePassword is also not required when auth was set via the drawer
        if (formComponent.propertyName === "savePassword" && serverCreatedWithAuth) {
            return true;
        }

        if (formComponent.validate) {
            return formComponent.validate(validationState, normalizedValue).isValid;
        }

        return formComponent.required ? !!value : true;
    });
}

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
    const connectionLoadState = useAzureSqlDatabaseDeploymentSelector((s) => s.connectionLoadState);
    const serverCreatedWithAuth = useAzureSqlDatabaseDeploymentSelector(
        (s) => s.serverCreatedWithAuth,
    );

    const [tags, setTags] = useState<TagEntry[]>([]);

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

    const hasProvisioningError =
        provisionLoadState === ApiStatus.Error || connectionLoadState === ApiStatus.Error;
    const isStateReady = !!formState && !!formComponents && "accountId" in formComponents;
    const isFormValid = isAzureSqlFormValid(
        loadState,
        formState,
        formComponents,
        serverCreatedWithAuth,
        validationState,
    );

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
                    tags={tags}
                    onTagsChange={setTags}
                />
            ),
            nextLabel: locConstants.azureSqlDatabase.createDatabase,
            canGoNext: () =>
                isFormValid &&
                formValidationLoadState !== ApiStatus.Loading &&
                !!formState?.accountId,
            onNext: () => {
                const tagsRecord: Record<string, string> = {};
                for (const tag of tags) {
                    const trimmedKey = tag.key.trim();
                    if (trimmedKey) {
                        tagsRecord[trimmedKey] = tag.value;
                    }
                }
                context.startAzureSqlDatabaseDeployment(tagsRecord);
                return false;
            },
        },
        {
            id: "azure-sql-provisioning",
            title: locConstants.azureSqlDatabase.provisioning,
            render: () => <AzureSqlDatabaseProvisioningPage />,
            canGoBack: () => hasProvisioningError,
            canGoNext: () => connectionLoadState === ApiStatus.Loaded,
            showCancel: () => hasProvisioningError,
            onPrevious: () => {
                // Reset validation so the user can re-submit
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
            icon={<AzureSqlDatabaseIcon aria-hidden="true" />}
            title={locConstants.deployment.deploymentHeader}
            pages={pages}
            onCancel={() => context.dispose()}
            maxContentWidth="wide"
        />
    );
};
