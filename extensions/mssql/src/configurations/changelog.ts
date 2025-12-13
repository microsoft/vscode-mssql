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
            title: "Edit Data (Preview)",
            description:
                "View, edit, add, and delete table rows in an interactive grid with real-time validation and live DML script previews.",
            codeSnippets: ["@mssql"],
            actions: [
                {
                    label: locConstants.Changelog.watchDemo,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-edit-data-demo",
                },
                {
                    label: locConstants.Changelog.learnMore,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-edit-data-blog",
                },
            ],
        },
        {
            title: "Fabric Browse / Provisioning (Preview)",
            description:
                "Browse Fabric workspaces and provision SQL databases directly from VS Code with a guided, developer-friendly flow.",
            actions: [
                {
                    label: locConstants.Changelog.watchDemo,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-fabric-db-demo",
                },
                {
                    label: locConstants.Changelog.learnMore,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-fabric-blog",
                },
            ],
        },
        {
            title: "Schema Designer (GA)",
            description:
                "Design, visualize, and evolve database schemas using an interactive diagram with synchronized SQL generation.",
            actions: [
                {
                    label: locConstants.Changelog.watchDemo,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-schema-designer-demo",
                },
                {
                    label: locConstants.Changelog.learnMore,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-schema-designer",
                },
            ],
        },
        {
            title: "Local SQL Server Container (GA)",
            description:
                "Create and manage local SQL Server containers directly from VS Code for fast, consistent local development.",
            actions: [
                {
                    label: locConstants.Changelog.watchDemo,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-container-demo",
                },
                {
                    label: locConstants.Changelog.learnMore,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-containers",
                },
            ],
        },
        {
            title: "GitHub Copilot integration (GA)",
            description:
                "Al-assisted SQL development with schema-aware query generation, ORM support, and natural language chat with @mssql in Ask or Agent Mode.",
            actions: [
                {
                    label: locConstants.Changelog.watchDemo,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-copilot-demo",
                },
                {
                    label: locConstants.Changelog.learnMore,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-november2025",
                },
                {
                    label: locConstants.Changelog.tryIt,
                    type: "command",
                    value: constants.cmdOpenGithubChat,
                    args: [`@${constants.mssqlChatParticipantName} Hello!`],
                },
            ],
        },
    ],
    resources: [
        {
            label: locConstants.Changelog.watchDemosOnYoutube,
            url: "https://aka.ms/vscode-mssql-demos",
        },
        {
            label: locConstants.Changelog.viewRoadmap,
            url: "https://aka.ms/vscode-mssql-roadmap",
        },
        {
            label: locConstants.Changelog.readTheDocumentation,
            url: "https://aka.ms/vscode-mssql-docs",
        },
        {
            label: locConstants.Changelog.joinTheDiscussions,
            url: "https://aka.ms/vscode-mssql-discussions",
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
        {
            label: locConstants.Changelog.customizeKeyboardShortcuts,
            url: "https://aka.ms/vscode-mssql-keyboard-shortcuts",
        },
    ],
    version: vscode.extensions.getExtension(constants.extensionId).packageJSON.version || "unknown",
};
