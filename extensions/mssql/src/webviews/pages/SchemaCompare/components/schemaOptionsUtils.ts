/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DacDeployOptionPropertyBoolean } from "vscode-mssql";
import { locConstants as loc } from "../../../common/locConstants";

const ALLOW_INCOMPATIBLE_PLATFORM_OPTION = "allowIncompatiblePlatform";

export interface SchemaCompareOptionPresentation {
    displayName: string;
    description: string;
}

/**
 * Returns Schema Compare-specific text for deployment options whose general DacFx wording can be
 * misleading in the comparison workflow.
 */
export function getSchemaCompareGeneralOptionPresentation(
    optionKey: string,
    option: DacDeployOptionPropertyBoolean,
): SchemaCompareOptionPresentation {
    if (optionKey.toLowerCase() === ALLOW_INCOMPATIBLE_PLATFORM_OPTION.toLowerCase()) {
        return {
            displayName: loc.schemaCompare.allowIncompatiblePlatformDisplayName,
            description: loc.schemaCompare.allowIncompatiblePlatformDescription,
        };
    }

    return {
        displayName: option.displayName,
        description: option.description,
    };
}
