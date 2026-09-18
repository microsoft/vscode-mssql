/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../constants/constants";
import { ChangelogActionId } from "../sharedInterfaces/changelog";

/** The command a changelog entry's action runs, plus any fixed arguments. */
export interface ChangelogCommand {
    command: string;
    args: unknown[];
}

/**
 * Maps a changelog action to its command. Shared by the Changelog webview and the Overview
 * page's What's new dialog, which render the same entries.
 */
export function resolveChangelogAction(action: ChangelogActionId): ChangelogCommand {
    switch (action) {
        case ChangelogActionId.OpenShortcutsConfiguration:
            return { command: constants.cmdOpenShortcutsConfiguration, args: [] };
        case ChangelogActionId.DeployNewDatabase:
            return { command: constants.cmdDeployNewDatabase, args: [] };
        case ChangelogActionId.CreateNotebook:
            return { command: constants.cmdNotebooksCreate, args: [] };
        case ChangelogActionId.OpenAzureDataStudioMigration:
            return { command: constants.cmdOpenAzureDataStudioMigration, args: [] };
        case ChangelogActionId.OpenDacpacDialog:
            return { command: constants.cmdDacpacDialog, args: [] };
        case ChangelogActionId.OpenMssqlWalkthrough:
            return {
                command: "workbench.action.openWalkthrough",
                args: [`${constants.extensionId}#mssql.getStarted`],
            };
        case ChangelogActionId.OpenCopilotWalkthrough:
            return {
                command: "workbench.action.openWalkthrough",
                args: ["GitHub.copilot-chat#copilotWelcome"],
            };
        default:
            throw new Error(`Unknown changelog action: ${action}`);
    }
}
