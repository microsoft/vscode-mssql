/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
export async function generatePublishFormComponents(): Promise<
    Record<keyof IPublishForm | string, PublishDialogFormItemSpec>
> {
    const components: Record<keyof IPublishForm | string, PublishDialogFormItemSpec> = {
        profilePath: {
            propertyName: "profilePath",
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

    // allow future async population here
    return components;
}
