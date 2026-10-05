/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../constants/constants";
import { ChangelogActionId } from "../sharedInterfaces/changelog";

export interface ChangelogCommand {
    command: string;
    args: unknown[];
}

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
