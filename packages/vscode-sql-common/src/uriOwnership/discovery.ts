/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { CoordinatingExtensionInfo, SqlExtensionCommonFeaturesContribution } from "./types";
import { PACKAGE_JSON_COMMON_FEATURES_KEY } from "./constants";

/**
 * Discovers other SQL extensions that declare URI ownership API in their package.json.
 *
 * Extensions declare their capability by adding to their package.json:
 * ```json
 * {
 *   "displayName": "SQL Server (mssql)",
 *   "contributes": {
 *     "vscode-sql-common-features": {
 *       "uriOwnershipApi": true
 *     }
 *   }
 * }
 * ```
 *
 * @param selfExtensionId The current extension's ID to exclude from results
 * @returns Array of discovered coordinating extensions
 */
export function discoverCoordinatingExtensions(
    selfExtensionId: string,
): CoordinatingExtensionInfo[] {
    const coordinatingExtensions: CoordinatingExtensionInfo[] = [];

    for (const extension of vscode.extensions.all) {
        // Skip ourselves
        if (extension.id.toLowerCase() === selfExtensionId.toLowerCase()) {
            continue;
        }

        // Check if extension declares SQL common features with URI ownership API
        const commonFeatures = extension.packageJSON?.contributes?.[
            PACKAGE_JSON_COMMON_FEATURES_KEY
        ] as SqlExtensionCommonFeaturesContribution | undefined;

        if (commonFeatures?.uriOwnershipApi) {
            coordinatingExtensions.push({
                extensionId: extension.id,
                displayName: extension.packageJSON?.displayName || extension.id,
            });
        }
    }

    return coordinatingExtensions;
}

/**
 * Gets the display name for a coordinating extension by its ID.
 * Falls back to the extension ID if not found.
 *
 * @param extensionId The extension ID to look up
 * @param coordinatingExtensions The list of known coordinating extensions
 * @returns The display name or the extension ID as fallback
 */
export function getExtensionDisplayName(
    extensionId: string,
    coordinatingExtensions: CoordinatingExtensionInfo[],
): string {
    const extension = coordinatingExtensions.find(
        (ext) => ext.extensionId.toLowerCase() === extensionId.toLowerCase(),
    );
    return extension?.displayName || extensionId;
}
