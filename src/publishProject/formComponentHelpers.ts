/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import { FormItemType } from "../sharedInterfaces/form";
import {
    IPublishForm,
    PublishDialogFormItemSpec,
    PublishDialogWebviewState,
} from "../sharedInterfaces/publishDialog";
import { PublishProject as Loc } from "../constants/locConstants";

/**
 * Generate publish form components. Kept async to mirror the connection pattern and allow
 * future async population of options (e.g. reading project metadata or remote targets).
 */
export async function generatePublishFormComponents(
    schemaCompareDefaults?: mssql.SchemaCompareOptionsResult,
): Promise<Record<keyof IPublishForm | string, PublishDialogFormItemSpec>> {
    const components: Record<keyof IPublishForm | string, PublishDialogFormItemSpec> = {
        profileName: {
            propertyName: "profileName",
            label: Loc.ProfileLabel,
            required: false,
            type: FormItemType.Input,
            isAdvancedOption: false,
        },
        serverName: {
            propertyName: "serverName",
            label: Loc.ServerLabel,
            required: false,
            type: FormItemType.Input,
            isAdvancedOption: false,
        },
        databaseName: {
            propertyName: "databaseName",
            label: Loc.DatabaseLabel,
            required: true,
            type: FormItemType.Input,
            isAdvancedOption: false,
            validate: (_state: PublishDialogWebviewState, value: string) => {
                const isValid = (value ?? "").trim().length > 0;
                return { isValid, validationMessage: isValid ? "" : Loc.DatabaseRequiredMessage };
            },
        },
        publishTarget: {
            propertyName: "publishTarget",
            label: Loc.PublishTargetLabel,
            required: true,
            type: FormItemType.Dropdown,
            isAdvancedOption: false,
            options: [
                {
                    displayName: Loc.PublishTargetExisting,
                    value: "existingServer",
                },
                {
                    displayName: Loc.PublishTargetContainer,
                    value: "localContainer",
                },
            ],
        },
    } as Record<keyof IPublishForm | string, PublishDialogFormItemSpec>;

    // If schema-compare defaults were provided, add dynamic components for them
    const defaults = schemaCompareDefaults?.defaultDeploymentOptions;

    if (defaults) {
        // Add boolean options as individual checkbox components grouped under 'Publish Options'
        const bools = defaults.booleanOptionsDictionary ?? {};
        for (const key of Object.keys(bools)) {
            components[key] = {
                propertyName: key as string,
                label: bools[key].displayName ?? key,
                required: false,
                type: FormItemType.Checkbox,
                tooltip: bools[key].description ?? undefined,
                isAdvancedOption: true,
                optionCategory: "publishOptions",
                optionCategoryLabel: Loc.PublishOptions,
            } as PublishDialogFormItemSpec;
        }

        // Add object-type exclusion options as checkboxes grouped under 'Exclude Options'
        const objectTypes = defaults.objectTypesDictionary ?? {};
        for (const key of Object.keys(objectTypes)) {
            const propName = `exclude_${key}`;
            components[propName] = {
                propertyName: propName as string,
                label: objectTypes[key] ?? key,
                required: false,
                type: FormItemType.Checkbox,
                tooltip: undefined,
                isAdvancedOption: true,
                optionCategory: "excludeOptions",
                optionCategoryLabel: Loc.ExcludeOptions,
            } as PublishDialogFormItemSpec;
        }
    }

    // allow future async population here
    return components;
}

export interface ComponentGroup {
    groupName?: string;
    options: (keyof IPublishForm)[];
}

/**
 * Simple grouping helper that mimics the connection dialog behavior: return a single
 * advanced group that contains all advanced options, but leave the helper extensible.
 */
export function groupAdvancedOptions(
    components: Record<keyof IPublishForm | string, PublishDialogFormItemSpec>,
): ComponentGroup[] {
    const groupMap: Map<string, ComponentGroup> = new Map();

    for (const option of Object.values(components)) {
        if (!option.isAdvancedOption) {
            continue;
        }
        const category = option.optionCategory;
        const categoryLabel =
            option.optionCategoryLabel ??
            (category === "publishOptions" ? Loc.PublishOptions : Loc.ExcludeOptions);
        if (!groupMap.has(category)) {
            groupMap.set(category, { groupName: categoryLabel, options: [] });
        }
        groupMap.get(category)!.options.push(option.propertyName as any);
    }

    return Array.from(groupMap.values());
}
