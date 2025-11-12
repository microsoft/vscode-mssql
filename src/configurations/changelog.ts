/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangelogWebviewState } from "../sharedInterfaces/changelog";
import * as vscode from "vscode";
import * as constants from "../constants/constants";
import * as locConstants from "../constants/locConstants";

export const changelogConfig: ChangelogWebviewState = {
    changes: [
        {
            title: "GitHub Copilot integration (GA)",
            description:
                "Get AI-powered query suggestions and explanations directly in your editor. Write SQL faster with intelligent completions.",
            actions: [
                {
                    label: locConstants.Changelog.tryIt,
                    type: "command",
                    value: constants.cmdOpenGithubChat,
                    args: [`@${constants.mssqlChatParticipantName} Hello!`],
                },
                {
                    label: locConstants.Changelog.readDocs,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-copilot-docs",
                },
            ],
        },
        {
            title: "Edit data",
            description:
                "Edit table data directly in the results grid with a streamlined interface. Save changes with a single click.",
            actions: [
                {
                    label: locConstants.Changelog.readDocs,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-edit-data",
                },
            ],
        },
        {
            title: "DACPAC/BACPAC import and export",
            description:
                "Deploy and extract database schemas and data using DACPAC and BACPAC files directly from the extension.",
            actions: [
                {
                    label: locConstants.Changelog.readDocs,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-dacpac-docs",
                },
            ],
        },
    ],
    resources: [
        {
            label: locConstants.Changelog.watchDemosOnYoutube,
            url: "https://aka.ms/vscode-mssql-youtube",
        },
        {
            label: locConstants.Changelog.viewKeyboardShortcuts,
            url: "https://aka.ms/vscode-mssql-shortcuts",
        },
        {
            label: locConstants.Changelog.readTheDocumentation,
            url: "https://aka.ms/vscode-mssql-docs",
        },
        {
            label: locConstants.Changelog.joinTheCommunity,
            url: "https://aka.ms/vscode-mssql-community",
        },
    ],
    walkthroughs: [
        {
            label: "MSSQL - VS Code walkthrough",
            walkthroughId: `${constants.extensionId}#mssql.getStarted`,
        },
        {
            label: "GitHub Copilot - VS Code walkthrough",
            walkthroughId: `GitHub.copilot-chat#copilotWelcome`,
        },
    ],
    version: vscode.extensions.getExtension(constants.extensionId).packageJSON.version || "unknown",
};
