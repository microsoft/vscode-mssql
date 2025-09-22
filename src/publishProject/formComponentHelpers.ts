/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../constants/constants";
import { FormItemType } from "../sharedInterfaces/form";
import {
    IPublishForm,
    PublishDialogFormItemSpec,
    PublishDialogState,
} from "../sharedInterfaces/publishDialog";
import { PublishProject as Loc } from "../constants/locConstants";
import { validateSqlServerPortNumber, isValidSqlAdminPassword } from "./dockerUtils";
import { getPublishServerName } from "./projectUtils";

/**
 * Generate publish form components. Kept async for future extensibility
 * (e.g. reading project metadata, fetching remote targets, etc.)
 */
export async function generatePublishFormComponents(): Promise<
    Record<keyof IPublishForm | string, PublishDialogFormItemSpec>
> {
    const components: Record<keyof IPublishForm | string, PublishDialogFormItemSpec> = {
        profileName: {
            propertyName: "profileName",
            label: Loc.ProfileLabel,
            required: false,
            type: FormItemType.Input,
        },
        serverName: {
            propertyName: "serverName",
            label: Loc.ServerLabel,
            required: false,
            type: FormItemType.Input,
        },
        databaseName: {
            propertyName: "databaseName",
            label: Loc.DatabaseLabel,
            required: true,
            type: FormItemType.Input,
            validate: (_state: PublishDialogState, value: string) => {
                const isValid = (value ?? "").trim().length > 0;
                return { isValid, validationMessage: isValid ? "" : Loc.DatabaseRequiredMessage };
            },
        },
        publishTarget: {
            propertyName: "publishTarget",
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
        containerPort: {
            propertyName: "containerPort",
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
        containerAdminPassword: {
            propertyName: "containerAdminPassword",
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
        containerAdminPasswordConfirm: {
            propertyName: "containerAdminPasswordConfirm",
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
            propertyName: "containerImageTag",
            label: Loc.SqlServerImageTag,
            required: true,
            type: FormItemType.Dropdown,
            options: [],
            validate: (_state: PublishDialogState, value) => {
                const v = String(value ?? "").trim();
                return { isValid: !!v, validationMessage: v ? "" : constants.RequiredFieldMessage };
            },
        },
        acceptContainerLicense: {
            propertyName: "acceptContainerLicense",
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
    } as Record<keyof IPublishForm | string, PublishDialogFormItemSpec>;

    return components;
}
