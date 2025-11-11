/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionOption } from "vscode-mssql";
import {
    AuthenticationType,
    ConnectionComponentGroup,
    ConnectionComponentsInfo,
    ConnectionDialogFormItemSpec,
    ConnectionDialogWebviewState,
    IConnectionDialogProfile,
} from "../sharedInterfaces/connectionDialog";
import {
    FormItemActionButton,
    FormItemOptions,
    FormItemSpec,
    FormItemType,
} from "../sharedInterfaces/form";
import { sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { ConnectionDialog as Loc } from "../constants/locConstants";
import { CapabilitiesResult, GetCapabilitiesRequest } from "../models/contracts/connection";
import { getErrorMessage } from "../utils/utils";
import ConnectionManager from "../controllers/connectionManager";
import { ConnectionDialogWebviewController } from "./connectionDialogWebviewController";

export async function generateConnectionComponents(
    connectionManager: ConnectionManager,
    azureAccountOptions: Promise<FormItemOptions[]>,
    azureActionButtons: Promise<FormItemActionButton[]>,
    connectionGroupOptions: Promise<FormItemOptions[]>,
): Promise<Record<keyof IConnectionDialogProfile, ConnectionDialogFormItemSpec>> {
    // get list of connection options from Tools Service
    const capabilitiesResult: CapabilitiesResult = await connectionManager.client.sendRequest(
        GetCapabilitiesRequest.type,
        {},
    );
    const connectionOptions: ConnectionOption[] =
        capabilitiesResult.capabilities.connectionProvider.options;

    const groupNames = capabilitiesResult.capabilities.connectionProvider.groupDisplayNames;

    const result: Record<
        keyof IConnectionDialogProfile,
        ConnectionDialogFormItemSpec
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    > = {} as any; // force empty record for intial blank state

    const _mainOptionNames = new Set<string>([
        ...ConnectionDialogWebviewController.mainOptions,
        "profileName",
        "groupId",
    ]);

    for (const option of connectionOptions) {
        try {
            result[option.name as keyof IConnectionDialogProfile] = {
                ...convertToFormComponent(option),
                isAdvancedOption: !_mainOptionNames.has(option.name),
                optionCategory: option.groupName,
                optionCategoryLabel: groupNames[option.groupName] ?? option.groupName,
            };
        } catch (err) {
            console.error(
                `Error loading connection option '${option.name}': ${getErrorMessage(err)}`,
            );
            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadConnectionProperties,
                err,
                true, // includeErrorMessage
                undefined, // errorCode
                undefined, // errorType
                {
                    connectionOptionName: option.name,
                }, // additionalProperties
            );
        }
    }

    await completeFormComponents(
        result,
        await azureAccountOptions,
        await azureActionButtons,
        await connectionGroupOptions,
    );

    return result;
}

export function groupAdvancedOptions(
    components: Record<keyof IConnectionDialogProfile, ConnectionDialogFormItemSpec>,
    componentsInfo: ConnectionComponentsInfo,
): ConnectionComponentGroup[] {
    const groupMap: Map<string, ConnectionComponentGroup> = new Map([
        // initialize with display order; any that aren't pre-defined will be appended
        // these values must match the GroupName defined in SQL Tools Service.
        ["general", undefined],
        ["security", undefined],
        ["resiliency", undefined],
        ["failover", undefined],
        ["pooling", undefined],
        ["context", undefined],
    ]);

    const optionsToGroup = Object.values(components).filter(
        (c) => c.isAdvancedOption && !componentsInfo.mainOptions.includes(c.propertyName),
    );

    for (const option of optionsToGroup) {
        if (
            // new group ID or group ID hasn't been initialized yet
            !groupMap.has(option.optionCategory) ||
            groupMap.get(option.optionCategory) === undefined
        ) {
            groupMap.set(option.optionCategory, {
                groupName: option.optionCategoryLabel,
                options: [option.propertyName],
            });
        } else {
            groupMap.get(option.optionCategory).options.push(option.propertyName);
        }
    }

    return Array.from(groupMap.values());
}

export function convertToFormComponent(
    connOption: ConnectionOption,
): FormItemSpec<
    IConnectionDialogProfile,
    ConnectionDialogWebviewState,
    ConnectionDialogFormItemSpec
> {
    switch (connOption.valueType) {
        case "boolean":
            return {
                propertyName: connOption.name as keyof IConnectionDialogProfile,
                label: connOption.displayName,
                required: connOption.isRequired,
                type: FormItemType.Checkbox,
                tooltip: connOption.description,
            };
        case "string":
            return {
                propertyName: connOption.name as keyof IConnectionDialogProfile,
                label: connOption.displayName,
                required: connOption.isRequired,
                type: FormItemType.Input,
                tooltip: connOption.description,
            };
        case "password":
            return {
                propertyName: connOption.name as keyof IConnectionDialogProfile,
                label: connOption.displayName,
                required: connOption.isRequired,
                type: FormItemType.Password,
                tooltip: connOption.description,
            };

        case "number":
            return {
                propertyName: connOption.name as keyof IConnectionDialogProfile,
                label: connOption.displayName,
                required: connOption.isRequired,
                type: FormItemType.Input,
                tooltip: connOption.description,
            };
        case "category":
            return {
                propertyName: connOption.name as keyof IConnectionDialogProfile,
                label: connOption.displayName,
                required: connOption.isRequired,
                type: FormItemType.Dropdown,
                tooltip: connOption.description,
                options: connOption.categoryValues.map((v) => {
                    return {
                        displayName: v.displayName ?? v.name, // Use name if displayName is not provided
                        value: v.name,
                    };
                }),
            };
        default:
            const error = `Unhandled connection option type: ${connOption.valueType}`;
            sendErrorEvent(
                TelemetryViews.ConnectionDialog,
                TelemetryActions.LoadConnectionProperties,
                new Error(error),
                true, // includeErrorMessage
            );
    }
}

export async function completeFormComponents(
    components: Partial<Record<keyof IConnectionDialogProfile, ConnectionDialogFormItemSpec>>,
    azureAccountOptions: FormItemOptions[],
    azureActionButtons: FormItemActionButton[],
    connectionGroupOptions: FormItemOptions[],
) {
    // Add additional components that are not part of the connection options
    components["profileName"] = {
        propertyName: "profileName",
        label: Loc.profileName,
        required: false,
        type: FormItemType.Input,
        isAdvancedOption: false,
    };

    components["groupId"] = getGroupIdFormItem(
        connectionGroupOptions,
    ) as ConnectionDialogFormItemSpec;

    components["savePassword"] = {
        propertyName: "savePassword",
        label: Loc.savePassword,
        required: false,
        type: FormItemType.Checkbox,
        isAdvancedOption: false,
    };

    components["accountId"] = {
        propertyName: "accountId",
        label: Loc.microsoftAccount,
        required: true,
        type: FormItemType.Dropdown,
        options: azureAccountOptions,
        placeholder: Loc.selectAnAccount,
        actionButtons: azureActionButtons,
        validate: (state: ConnectionDialogWebviewState, value: string) => {
            if (
                state.connectionProfile.authenticationType === AuthenticationType.AzureMFA &&
                !value
            ) {
                return {
                    isValid: false,
                    validationMessage: Loc.microsoftAccountIsRequired,
                };
            }
            return {
                isValid: true,
                validationMessage: "",
            };
        },
        isAdvancedOption: false,
    };

    components["tenantId"] = {
        propertyName: "tenantId",
        label: Loc.tenantId,
        required: true,
        type: FormItemType.Dropdown,
        options: [],
        hidden: true,
        placeholder: Loc.selectATenant,
        validate: (state: ConnectionDialogWebviewState, value: string) => {
            if (
                state.connectionProfile.authenticationType === AuthenticationType.AzureMFA &&
                !value
            ) {
                return {
                    isValid: false,
                    validationMessage: Loc.tenantIdIsRequired,
                };
            }
            return {
                isValid: true,
                validationMessage: "",
            };
        },
        isAdvancedOption: false,
    };

    components["connectionString"] = {
        type: FormItemType.TextArea,
        propertyName: "connectionString",
        label: Loc.connectionString,
        required: true,
        isAdvancedOption: false,
    };

    // add missing validation functions for generated components
    components["server"].validate = (state: ConnectionDialogWebviewState, value: string) => {
        if (!value) {
            return {
                isValid: false,
                validationMessage: Loc.serverIsRequired,
            };
        }
        return {
            isValid: true,
            validationMessage: "",
        };
    };

    components["user"].validate = (state: ConnectionDialogWebviewState, value: string) => {
        if (state.connectionProfile.authenticationType === AuthenticationType.SqlLogin && !value) {
            return {
                isValid: false,
                validationMessage: Loc.usernameIsRequired,
            };
        }
        return {
            isValid: true,
            validationMessage: "",
        };
    };
}

export function getGroupIdFormItem(connectionGroupOptions: FormItemOptions[]) {
    return {
        propertyName: "groupId",
        label: Loc.connectionGroup,
        required: false,
        type: FormItemType.SearchableDropdown,
        options: connectionGroupOptions,
        isAdvancedOption: false,
        placeholder: Loc.selectConnectionGroup,
        searchBoxPlaceholder: Loc.searchConnectionGroups,
    };
}
