/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangelogWebviewState } from "../sharedInterfaces/changelog";
import * as vscode from "vscode";
import * as constants from "../constants/constants";
import * as locConstants from "../constants/locConstants";

export const changelogConfig: ChangelogWebviewState = {
    primaryContent: [
        {
            title: "Azure Data Studio Connection Migration Toolkit",
            description:
                "Migrate saved connections and connection groups from Azure Data Studio into the MSSQL extension. This guided experience helps you continue working with familiar environments with minimal setup.",
            icon: "azureDataStudio.svg",
            actions: [
                {
                    label: locConstants.Changelog.tryIt,
                    type: "command",
                    value: constants.cmdOpenAzureDataStudioMigration,
                },
                {
                    label: locConstants.Changelog.watchDemo,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-ads-migration-demo",
                },
                {
                    label: locConstants.Changelog.learnMore,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-january2026",
                },
            ],
        },
        {
            title: "Backup Database",
            description:
                "Back up databases using a built-in, guided experience in the MSSQL extension. Quickly protect data databases as part of your normal workflow.",
            codeSnippets: ["@mssql"],
            actions: [
                {
                    label: locConstants.Changelog.watchDemo,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-backup-restore-demo",
                },
                {
                    label: locConstants.Changelog.learnMore,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-january2026",
                },
            ],
        },
        {
            title: "Edit Data (Preview)",
            description:
                "View, edit, add, and delete table rows in an interactive grid with real-time validation and live DML script previews.",
            actions: [
                {
                    label: locConstants.Changelog.watchDemo,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-edit-data-demo",
                },
                {
                    label: locConstants.Changelog.learnMore,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-edit-data",
                },
            ],
        },
        {
            title: "Data-Tier Application (DACPAC / BACPAC) Import & Export (Preview)",
            description:
                "Deploy and extract .dacpac files or import/export .bacpac packages using an integrated, streamlined workflow in the MSSQL extension.",
            actions: [
                {
                    label: locConstants.Changelog.tryIt,
                    type: "command",
                    value: constants.cmdDacpacDialog,
                },
                {
                    label: locConstants.Changelog.watchDemo,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-dacpac-demo",
                },
                {
                    label: locConstants.Changelog.learnMore,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-dacpac-docs",
                },
            ],
        },
        {
            title: "SQL Database Projects – Publish Dialog (Preview)",
            description:
                "Deploy database changes using a guided Publish Dialog in SQL Database Projects, with script preview for SQL Server and Azure SQL databases.",
            actions: [
                {
                    label: locConstants.Changelog.watchDemo,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-sqlproj-publish-demo",
                },
                {
                    label: locConstants.Changelog.learnMore,
                    type: "link",
                    value: "https://aka.ms/vscode-mssql-sqlproj-publish-docs",
                },
            ],
        },
    ],
    sidebarContent: [
        {
            title: "Resources",
            description: "Explore tutorials, docs, and what's coming next.",
            actions: [
                {
                    type: "link",
                    label: locConstants.Changelog.watchDemosOnYoutube,
                    value: "https://aka.ms/vscode-mssql-demos",
                    icon: "VideoClip16Filled",
                },
                {
                    type: "link",
                    label: locConstants.Changelog.viewRoadmap,
                    value: "https://aka.ms/vscode-mssql-roadmap",
                },
                {
                    type: "link",
                    label: locConstants.Changelog.readTheDocumentation,
                    value: "https://aka.ms/vscode-mssql-docs",
                    icon: "BookOpen16Filled",
                },
            ],
        },
        {
            title: "Feedback",
            description: "Help us improve by sharing your thoughts.",
            actions: [
                {
                    type: "link",
                    label: "Open a new bug",
                    value: "https://aka.ms/vscode-mssql-bug",
                    icon: "Bug16Regular",
                },
                {
                    type: "link",
                    label: "Request a new feature",
                    value: "https://aka.ms/vscode-mssql-feature-request",
                    icon: "Lightbulb16Regular",
                },
                {
                    type: "link",
                    label: locConstants.Changelog.joinTheDiscussions,
                    value: "https://aka.ms/vscode-mssql-discussions",
                    icon: "Chat16Regular",
                },
                {
                    type: "link",
                    label: "GitHub Copilot survey",
                    value: "https://aka.ms/vscode-mssql-copilot-survey",
                    icon: "ClipboardBulletList16Regular",
                },
            ],
        },
        {
            title: "Getting Started",
            description: "New to the MSSQL extension? Check out our quick-start guide.",
            actions: [
                {
                    type: "walkthrough",
                    label: "MSSQL - VS Code walkthrough",
                    value: `${constants.extensionId}#mssql.getStarted`,
                },
                {
                    type: "walkthrough",
                    label: "GitHub Copilot - VS Code walkthrough",
                    value: `GitHub.copilot-chat#copilotWelcome`,
                },
                {
                    type: "link",
                    label: locConstants.Changelog.customizeKeyboardShortcuts,
                    value: "https://aka.ms/vscode-mssql-keyboard-shortcuts",
                },
            ],
        },
    ],
    version: vscode.extensions.getExtension(constants.extensionId).packageJSON.version || "unknown",
};
