/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../constants/constants";
import { FormItemType, FormItemOptions } from "../sharedInterfaces/form";
import { PublishProject as Loc, Common } from "../constants/locConstants";
import {
    IPublishForm,
    PublishDialogFormItemSpec,
    PublishDialogState,
    PublishTarget,
    PublishFormFields,
} from "../sharedInterfaces/publishDialog";
import {
    getPublishServerName,
    validateSqlServerPortNumber,
    isPreviewFeaturesEnabled,
} from "./projectUtils";
import { validateSqlServerPassword } from "../deployment/dockerUtils";

/**
 * Generate publish target options based on project target version
 * @param projectTargetVersion - The target version of the project (e.g., "AzureV12" for Azure SQL)
 * @returns Array of publish target options
 */
function generatePublishTargetOptions(projectTargetVersion?: string): FormItemOptions[] {
    // Check if this is an Azure SQL project
    const isAzureSqlProject = projectTargetVersion === constants.AzureSqlV12;
    const options: FormItemOptions[] = [
        {
            displayName: isAzureSqlProject
                ? Loc.PublishTargetExistingLogical
                : Loc.PublishTargetExisting,
            value: PublishTarget.ExistingServer,
        },
        {
            displayName: isAzureSqlProject
                ? Loc.PublishTargetAzureEmulator
                : Loc.PublishTargetContainer,
            value: PublishTarget.LocalContainer,
        },
    ];
    if (isAzureSqlProject) {
        // Only show "Publish to New Azure Server" option if preview feature tag is enabled
        if (isPreviewFeaturesEnabled()) {
            options.push({
                displayName: Loc.PublishTargetNewAzureServer,
                value: PublishTarget.NewAzureServer,
            });
        }
    }

    return options;
}

/**
 * Generate publish form components. Kept async for future extensibility
 * (e.g. reading project metadata, fetching remote targets, etc.)
 * @param projectTargetVersion - The target version of the project (e.g., "AzureV12" for Azure SQL)
 */
export function generatePublishFormComponents(
    projectTargetVersion?: string,
): Record<keyof IPublishForm, PublishDialogFormItemSpec> {
    const components: Record<keyof IPublishForm, PublishDialogFormItemSpec> = {
        publishProfilePath: {
            propertyName: PublishFormFields.PublishProfilePath,
            label: Loc.PublishProfileLabel,
            required: false,
            type: FormItemType.Input,
        },
        serverName: {
            propertyName: PublishFormFields.ServerName,
            label: Loc.ServerLabel,
            required: true,
            type: FormItemType.Input,
        },
        databaseName: {
            propertyName: PublishFormFields.DatabaseName,
            label: Loc.DatabaseLabel,
            required: true,
            type: FormItemType.Input,
            validate: (_state: PublishDialogState, value: string) => {
                const isValid = (value ?? "").trim().length > 0;
                return { isValid, validationMessage: isValid ? "" : Loc.DatabaseRequiredMessage };
            },
        },
        publishTarget: {
            propertyName: PublishFormFields.PublishTarget,
            label: Loc.PublishTargetLabel,
            required: true,
            type: FormItemType.Dropdown,
            options: generatePublishTargetOptions(projectTargetVersion),
        },
        containerPort: {
            propertyName: PublishFormFields.ContainerPort,
            label: Loc.SqlServerPortNumber,
            required: true,
            type: FormItemType.Input,
            validate: (_state: PublishDialogState, value) => {
                const str = String(value ?? "").trim();
                const port = Number(str);
                const isValid = str.length > 0 && !isNaN(port) && validateSqlServerPortNumber(port);
                return {
                    isValid,
                    validationMessage: isValid ? "" : Loc.InvalidPortMessage,
                };
            },
        },
        containerAdminPassword: {
            propertyName: PublishFormFields.ContainerAdminPassword,
            label: Loc.SqlServerAdminPassword,
            required: true,
            type: FormItemType.Password,
            validate: (_state: PublishDialogState, value) => {
                const pwd = String(value ?? "");
                const errorMessage = validateSqlServerPassword(pwd);
                return {
                    isValid: !errorMessage,
                    validationMessage: errorMessage,
                };
            },
        },
        containerAdminPasswordConfirm: {
            propertyName: PublishFormFields.ContainerAdminPasswordConfirm,
            label: Loc.SqlServerAdminPasswordConfirm,
            required: true,
            type: FormItemType.Password,
            validate: (state: PublishDialogState, value) => {
                const confirm = String(value ?? "");
                const orig = state.formState.containerAdminPassword ?? "";
                const match = confirm === orig && confirm.length >= 8;
                return {
                    isValid: match,
                    validationMessage: match
                        ? ""
                        : Loc.PasswordNotMatchMessage(
                              getPublishServerName(state.projectProperties?.targetVersion),
                          ),
                };
            },
        },
        containerImageTag: {
            propertyName: PublishFormFields.ContainerImageTag,
            label: Loc.SqlServerImageTag,
            required: true,
            type: FormItemType.Dropdown,
            options: [],
            validate: (_state: PublishDialogState, value) => {
                const v = String(value ?? "").trim();
                return { isValid: !!v, validationMessage: v ? "" : Loc.RequiredFieldMessage };
            },
        },
        acceptContainerLicense: {
            propertyName: PublishFormFields.AcceptContainerLicense,
            label: `<span>
						${Common.accept}
						<a
							href="${constants.licenseAgreementUrl}"
							target="_blank"
							rel="noopener noreferrer"
						>
							${Loc.SqlServerLicenseAgreement}
						</a>
					</span>`,
            required: true,
            type: FormItemType.Checkbox,
            validate: (_state: PublishDialogState, value) => {
                const accepted = value === true || value === "true";
                return {
                    isValid: accepted,
                    validationMessage: accepted ? "" : Loc.LicenseAcceptanceMessage,
                };
            },
        },
        sqlCmdVariables: {
            propertyName: "sqlCmdVariables",
            label: Loc.SqlCmdVariablesLabel,
            required: false,
            type: FormItemType.Input,
            hidden: true,
        },
    };

    return components;
}
