/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from "semver";
import * as vscode from "vscode";
import { LegacyProjectExtensionWarning } from "./constants/locConstants";
import { logger } from "./models/logger";
import { getErrorMessage } from "./utils/utils";

const showExtensionsCommand = "workbench.extensions.action.showExtensionsWithIds";

export const legacyProjectExtensions = [
    {
        id: "ms-mssql.data-workspace-vscode",
        maximumVersion: "0.7.0",
    },
    {
        id: "ms-mssql.sql-database-projects-vscode",
        maximumVersion: "1.8.0",
    },
] as const;

export function getOutdatedLegacyProjectExtensionIds(): string[] {
    return legacyProjectExtensions.flatMap(({ id, maximumVersion }) => {
        const extension = vscode.extensions.getExtension(id);
        const installedVersion = extension?.packageJSON.version;
        return typeof installedVersion === "string" &&
            semver.valid(installedVersion) &&
            semver.lte(installedVersion, maximumVersion)
            ? [id]
            : [];
    });
}

export async function showLegacyProjectExtensionWarning(): Promise<void> {
    const outdatedExtensionIds = getOutdatedLegacyProjectExtensionIds();

    if (outdatedExtensionIds.length === 0) {
        return;
    }

    const selection = await vscode.window.showWarningMessage(
        LegacyProjectExtensionWarning.message,
        LegacyProjectExtensionWarning.showExtensions,
    );

    if (selection !== LegacyProjectExtensionWarning.showExtensions) {
        return;
    }

    try {
        await vscode.commands.executeCommand(showExtensionsCommand, outdatedExtensionIds);
    } catch (error) {
        logger.error(
            `Failed to open legacy project extensions in the Extensions view: ${getErrorMessage(error)}`,
        );
        void vscode.window.showErrorMessage(LegacyProjectExtensionWarning.showExtensionsFailed);
    }
}
