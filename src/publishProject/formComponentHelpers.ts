/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../constants/constants";
import { FormItemType } from "../sharedInterfaces/form";
import { PublishProject as Loc } from "../constants/locConstants";
import {
    IPublishForm,
    PublishDialogFormItemSpec,
    PublishDialogState,
} from "../sharedInterfaces/publishDialog";
import {
    getPublishServerName,
    validateSqlServerPortNumber,
    isValidSqlAdminPassword,
} from "./projectUtils";

/**
 * Generate publish form components. Kept async for future extensibility
 * (e.g. reading project metadata, fetching remote targets, etc.)
 */
export async function generatePublishFormComponents(): Promise<
    Record<keyof IPublishForm, PublishDialogFormItemSpec>
> {
    const components: Record<keyof IPublishForm, PublishDialogFormItemSpec> = {
        [constants.PublishFormFields.ProfileName]: {
            propertyName: constants.PublishFormFields.ProfileName,
            label: Loc.ProfileLabel,
            required: false,
            type: FormItemType.Input,
        },
        [constants.PublishFormFields.ServerName]: {
            propertyName: constants.PublishFormFields.ServerName,
            label: Loc.ServerLabel,
            required: true,
            type: FormItemType.Input,
        },
        [constants.PublishFormFields.DatabaseName]: {
            propertyName: constants.PublishFormFields.DatabaseName,
            label: Loc.DatabaseLabel,
            required: true,
            type: FormItemType.Input,
            validate: (_state: PublishDialogState, value: string) => {
                const isValid = (value ?? "").trim().length > 0;
                return { isValid, validationMessage: isValid ? "" : Loc.DatabaseRequiredMessage };
            },
        },
        [constants.PublishFormFields.PublishTarget]: {
            propertyName: constants.PublishFormFields.PublishTarget,
            label: Loc.PublishTargetLabel,
            required: true,
            type: FormItemType.Dropdown,
            options: [
                {
                    displayName: Loc.PublishTargetExisting,
                    value: constants.PublishTargets.EXISTING_SERVER,
                },
                {
                    displayName: Loc.PublishTargetContainer,
                    value: constants.PublishTargets.LOCAL_CONTAINER,
                },
            ],
        },
        [constants.PublishFormFields.ContainerPort]: {
            propertyName: constants.PublishFormFields.ContainerPort,
            label: Loc.SqlServerPortNumber,
            required: true,
            type: FormItemType.Input,
            validate: (_state: PublishDialogState, value) => {
                const str = String(value ?? "").trim();
                const isValid = validateSqlServerPortNumber(str);
                return {
                    isValid,
                    validationMessage: isValid ? "" : Loc.InvalidPortMessage,
                };
            },
        },
        [constants.PublishFormFields.ContainerAdminPassword]: {
            propertyName: constants.PublishFormFields.ContainerAdminPassword,
            label: Loc.SqlServerAdminPassword,
            required: true,
            type: FormItemType.Password,
            validate: (state: PublishDialogState, value) => {
                const pwd = String(value ?? "");
                const isValid = isValidSqlAdminPassword(pwd, constants.DefaultAdminUsername);
                return {
                    isValid,
                    validationMessage: isValid
                        ? ""
                        : Loc.InvalidSQLPasswordMessage(
                              getPublishServerName(state.projectProperties?.targetVersion),
                          ),
                };
            },
        },
        [constants.PublishFormFields.ContainerAdminPasswordConfirm]: {
            propertyName: constants.PublishFormFields.ContainerAdminPasswordConfirm,
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
        [constants.PublishFormFields.ContainerImageTag]: {
            propertyName: constants.PublishFormFields.ContainerImageTag,
            label: Loc.SqlServerImageTag,
            required: true,
            type: FormItemType.Dropdown,
            options: [],
            validate: (_state: PublishDialogState, value) => {
                const v = String(value ?? "").trim();
                return { isValid: !!v, validationMessage: v ? "" : constants.RequiredFieldMessage };
            },
        },
        [constants.PublishFormFields.AcceptContainerLicense]: {
            propertyName: constants.PublishFormFields.AcceptContainerLicense,
            label: Loc.UserLicenseAgreement(
                "https://github.com/microsoft/containerregistry/blob/main/legal/Container-Images-Legal-Notice.md",
            ),
            required: true,
            type: FormItemType.Checkbox,
            validate: (_state: PublishDialogState, value) => {
                const accepted = value === true || value === "true";
                return {
                    isValid: accepted,
                    validationMessage: accepted ? "" : constants.LicenseAcceptanceMessage,
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
